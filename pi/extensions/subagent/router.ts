import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Pure routing logic: no Pi imports, so it's testable with plain `node --test`, like runner.ts.
// The router only *suggests* models; the caller must still have the user confirm one.

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "subagent-routes.json");
export const LOG_PATH = join(homedir(), ".pi", "agent", "router", "decisions.jsonl");
/** Added by the service to every request; never configured. */
export const OTHER = "other";
const ROUTE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_DESCRIPTION = 400; // the service's limit
const MAX_TASK = 50_000; // the service's limit
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface Route { name: string; description: string; models: string[] }
/** When a backend's top pick is too weak to trust. Unset fields don't apply. */
export interface UnsureRule { minP?: number; minMargin?: number }
export interface RouterConfig {
  service: string;
  backends: string[];
  primary: string;
  timeoutMs: number;
  /** In preference order; the same order is sent to the service. */
  routes: Route[];
  unsure: Record<string, UnsureRule>;
}

export interface Scored { route: string; p: number }
export type BackendResult =
  | { ranked: Scored[]; latencyMs: number; truncated?: boolean }
  | { error: string };
export type RouteOutcome =
  | { status: "ok"; results: Record<string, BackendResult> }
  | { status: "unavailable"; reason: string };

export interface Choice {
  provider: string;
  model: string;
  route: string;
  /** Each backend's probability for `route`; missing if that backend failed. */
  scores: Record<string, number | undefined>;
}
export interface Suggestions {
  choices: Choice[];
  /** Backend whose ranking ordered `choices` (the primary unless it failed). */
  rankedBy: string;
  unsure: boolean;
  /** One line for the picker title, e.g. "arch-router: explore 0.89 · laya-…: test 0.31 (disagree)". */
  summary: string;
  /** Configured models that aren't available in this Pi. */
  unavailable: string[];
}

function fail(message: string): never {
  throw new Error(`subagent-routes.json: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) {
    fail(`${what} must be an array of nonempty strings`);
  }
  if (new Set(value).size !== value.length) fail(`${what} has duplicates`);
  return value as string[];
}

export function parseConfig(raw: unknown): RouterConfig {
  if (!isObject(raw)) fail("must be a JSON object");
  const service = raw.service;
  if (typeof service !== "string") fail("service must be a URL string");
  let url: URL;
  try { url = new URL(service); } catch { fail(`service is not a URL: ${service}`); }
  // Tasks can contain private code and context; never send them off the machine.
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) fail("service must be an http:// loopback URL");

  const backends = stringList(raw.backends, "backends");
  if (!backends.length) fail("backends must not be empty");
  const primary = raw.primary ?? backends[0];
  if (typeof primary !== "string" || !backends.includes(primary)) fail("primary must be one of backends");

  const timeoutMs = raw.timeoutMs ?? 3000;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("timeoutMs must be positive");

  if (!isObject(raw.routes) || !Object.keys(raw.routes).length) fail("routes must be a nonempty object");
  const routes = Object.entries(raw.routes).map(([name, value]): Route => {
    if (!ROUTE_NAME.test(name)) fail(`route "${name}": names are lowercase letters, digits, '-' or '_', up to 32 characters`);
    if (name === OTHER) fail(`route "${OTHER}" is added automatically; don't define it`);
    if (!isObject(value)) fail(`route "${name}" must be an object`);
    const { description } = value;
    if (typeof description !== "string" || !description.trim() || description.length > MAX_DESCRIPTION) {
      fail(`route "${name}": description must be 1-${MAX_DESCRIPTION} characters`);
    }
    const models = stringList(value.models, `route "${name}" models`);
    if (!models.length) fail(`route "${name}" has no models`);
    for (const m of models) if (m.indexOf("/") < 1) fail(`route "${name}": "${m}" is not provider/model`);
    return { name, description, models };
  });

  const unsure: Record<string, UnsureRule> = {};
  if (raw.unsure !== undefined) {
    if (!isObject(raw.unsure)) fail("unsure must be an object of backend -> rule");
    for (const [backend, rule] of Object.entries(raw.unsure)) {
      if (!backends.includes(backend)) fail(`unsure: unknown backend "${backend}"`);
      if (!isObject(rule)) fail(`unsure.${backend} must be an object`);
      for (const key of Object.keys(rule)) {
        const v = rule[key];
        if (key !== "minP" && key !== "minMargin") fail(`unsure.${backend}: unknown key "${key}"`);
        if (typeof v !== "number" || v < 0 || v > 1) fail(`unsure.${backend}.${key} must be between 0 and 1`);
      }
      unsure[backend] = rule as UnsureRule;
    }
  }
  return { service: service.replace(/\/+$/, ""), backends, primary, timeoutMs, routes, unsure };
}

/** `undefined` when there is no config file: routing is off, not broken. */
export async function loadConfig(path = CONFIG_PATH): Promise<RouterConfig | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (error) { fail(`invalid JSON: ${(error as Error).message}`); }
  return parseConfig(raw);
}

function parseBackendResult(value: unknown): BackendResult | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.error === "string") return { error: value.error };
  const { ranked, latency_ms: latencyMs, truncated } = value;
  if (!Array.isArray(ranked) || typeof latencyMs !== "number") return undefined;
  const scored: Scored[] = [];
  for (const item of ranked) {
    if (!isObject(item) || typeof item.route !== "string" || typeof item.p !== "number") return undefined;
    scored.push({ route: item.route, p: item.p });
  }
  return typeof truncated === "boolean" ? { ranked: scored, latencyMs, truncated } : { ranked: scored, latencyMs };
}

/**
 * Ask the service to rank `task`. Never throws: anything short of an answer is "unavailable",
 * so the caller can fall back to the full model picker.
 */
export async function route(
  task: string,
  config: RouterConfig,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<RouteOutcome> {
  const unavailable = (reason: string): RouteOutcome => ({ status: "unavailable", reason });
  if (options.signal?.aborted) return unavailable("cancelled");
  const signals = [AbortSignal.timeout(config.timeoutMs), ...(options.signal ? [options.signal] : [])];
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${config.service}/v1/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: task.slice(0, MAX_TASK),
        routes: config.routes.map(({ name, description }) => ({ name, description })),
        backends: config.backends,
      }),
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    if (options.signal?.aborted) return unavailable("cancelled");
    const e = error as Error & { cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
    if (e.name === "TimeoutError") return unavailable(`router timed out after ${config.timeoutMs} ms`);
    // `localhost` tries IPv6 and IPv4, and reports both refusals as an AggregateError.
    const codes = [e.cause?.code, ...(e.cause?.errors ?? []).map((x) => x.code)];
    if (codes.includes("ECONNREFUSED")) return unavailable(`router not running at ${config.service}`);
    return unavailable(`router request failed: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  }
  let body: unknown;
  try { body = await response.json(); } catch { return unavailable(`router sent invalid JSON (HTTP ${response.status})`); }
  if (!response.ok) {
    const detail = isObject(body) && body.detail !== undefined ? JSON.stringify(body.detail) : "";
    return unavailable(`router returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  if (!isObject(body) || !isObject(body.results)) return unavailable("router response has no results");
  const results: Record<string, BackendResult> = {};
  for (const backend of config.backends) {
    const parsed = parseBackendResult(body.results[backend]);
    results[backend] = parsed ?? { error: "missing or malformed result" };
  }
  if (Object.values(results).every((r) => "error" in r)) {
    return unavailable(`every backend failed (${config.backends.map((b) => `${b}: ${(results[b] as { error: string }).error}`).join("; ")})`);
  }
  return { status: "ok", results };
}

function isUnsure(ranked: Scored[], rule: UnsureRule | undefined): boolean {
  const [top, second] = ranked;
  if (!top || top.route === OTHER) return true;
  if (rule?.minP !== undefined && top.p < rule.minP) return true;
  if (rule?.minMargin !== undefined && top.p - (second?.p ?? 0) < rule.minMargin) return true;
  return false;
}

/**
 * Turn rankings into picker rows: routes in the ranking backend's order, each route's models in
 * config order. A model listed under several routes appears once, at its best position.
 */
export function suggest(
  results: Record<string, BackendResult>,
  config: RouterConfig,
  available: Iterable<{ provider: string; id: string }>,
): Suggestions {
  const have = new Set([...available].map((m) => `${m.provider}/${m.id}`));
  const ok = (b: string) => { const r = results[b]; return r && !("error" in r) ? r : undefined; };
  const rankedBy = ok(config.primary) ? config.primary : config.backends.find((b) => ok(b));
  if (!rankedBy) throw new Error("suggest() needs at least one successful backend result");
  const ranking = ok(rankedBy)!.ranked;
  const byName = new Map(config.routes.map((r) => [r.name, r]));
  const scoreOf = (backend: string, name: string) => ok(backend)?.ranked.find((s) => s.route === name)?.p;

  const choices: Choice[] = [];
  const seen = new Set<string>();
  // Routes the service didn't rank (shouldn't happen) go last rather than vanish.
  const order = [...ranking.map((s) => s.route), ...config.routes.map((r) => r.name)];
  for (const name of order) {
    const r = byName.get(name);
    if (!r) continue; // `other`, or a route the config no longer has
    for (const id of r.models) {
      if (seen.has(id) || !have.has(id)) continue;
      seen.add(id);
      const slash = id.indexOf("/");
      choices.push({
        provider: id.slice(0, slash), model: id.slice(slash + 1), route: name,
        scores: Object.fromEntries(config.backends.map((b) => [b, scoreOf(b, name)])),
      });
    }
  }

  const tops = config.backends.map((b) => {
    const r = results[b];
    if (!r || "error" in r) return { b, text: `${b}: failed`, top: undefined };
    const top = r.ranked[0];
    return { b, text: `${b}: ${top ? `${top.route} ${top.p.toFixed(2)}` : "no ranking"}${r.truncated ? " (truncated)" : ""}`, top: top?.route };
  });
  const picks = new Set(tops.map((t) => t.top).filter(Boolean));
  const unsure = isUnsure(ranking, config.unsure[rankedBy]);
  const summary = tops.map((t) => t.text).join(" · ")
    + (picks.size > 1 ? " (disagree)" : "")
    + (rankedBy !== config.primary ? ` · ranked by ${rankedBy}` : "")
    + (unsure ? " · unsure" : "");
  const unavailable = [...new Set(config.routes.flatMap((r) => r.models))].filter((id) => !have.has(id));
  return { choices, rankedBy, unsure, summary, unavailable };
}

/** Picker row label. Unique per choice because each model appears once. */
export function formatChoice(choice: Choice, backends: string[]): string {
  const scores = backends
    .map((b) => `${b} ${choice.scores[b] === undefined ? "–" : choice.scores[b]!.toFixed(2)}`)
    .join(" · ");
  return `${choice.provider}/${choice.model}   ${choice.route}   ${scores}`;
}

export interface Decision {
  time: string;
  task: string;
  outcome: RouteOutcome;
  rankedBy?: string;
  /** What the user picked; `route` is absent when they chose from the full model list. */
  picked: { provider: string; model: string; route?: string } | null;
  /** Whether the pick was the first suggested row. */
  tookTopSuggestion: boolean;
}

/** Append one decision. The log holds task text, so it's private to the user. */
export async function logDecision(decision: Decision, path = LOG_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(decision)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created; tighten one made by hand too.
  await chmod(path, 0o600);
}

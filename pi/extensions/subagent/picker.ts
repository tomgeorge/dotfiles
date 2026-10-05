import {
  formatChoice, loadConfig, logDecision, route, suggest,
  type Decision, type RouteOutcome, type RouterConfig,
} from "./router.ts";

// The confirm-a-model flow, with the UI injected so it's testable without Pi.

export const ALL_MODELS = "All models…";

export interface PickerUI {
  select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
  /** Footer status while the router runs; `undefined` clears it. */
  status?(text: string | undefined): void;
  /** Non-fatal problems: bad config, a failed log write. */
  warn?(text: string): void;
}
export interface Model { provider: string; id: string }
export interface Picked { provider: string; model: string }
export interface PickDeps {
  loadConfig: () => Promise<RouterConfig | undefined>;
  route: typeof route;
  logDecision: (decision: Decision) => Promise<void>;
  now: () => Date;
}
const defaultDeps: PickDeps = { loadConfig: () => loadConfig(), route, logDecision: (d) => logDecision(d), now: () => new Date() };

/** The task on one line, cut to fit a few wrapped lines under the picker title. */
export function taskPreview(task: string, max = 240): string {
  const flat = task.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function split(id: string): Picked {
  const slash = id.indexOf("/");
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

/**
 * Rank `task` with the local router and have the user confirm a model. Falls back to the full
 * model list whenever routing is off or fails. Returns `undefined` if the user cancels.
 */
export async function pickModel(
  task: string,
  ui: PickerUI,
  available: Model[],
  options: { signal?: AbortSignal; via: Decision["via"]; deps?: Partial<PickDeps> },
): Promise<Picked | undefined> {
  const deps = { ...defaultDeps, ...options.deps };
  const all = available.map((m) => `${m.provider}/${m.id}`).sort();
  if (!all.length) throw new Error("No available models. Configure Pi authentication first.");
  const signal = options.signal;
  const taskLine = `\nTask: ${taskPreview(task)}`;

  let config: RouterConfig | undefined;
  try {
    config = await deps.loadConfig();
  } catch (error) {
    ui.warn?.(`Model routing off: ${(error as Error).message}`);
  }
  if (!config) {
    const id = await ui.select(`Subagent model${taskLine}`, all, { signal });
    return id ? split(id) : undefined;
  }

  let outcome: RouteOutcome;
  ui.status?.("Routing subagent task…");
  try {
    outcome = await deps.route(task, config, { signal });
  } finally {
    ui.status?.(undefined);
  }

  let picked: Picked | undefined;
  let rankedBy: string | undefined;
  let route_: string | undefined;
  let tookTopSuggestion = false;
  if (outcome.status === "ok") {
    const s = suggest(outcome.results, config, available);
    rankedBy = s.rankedBy;
    const rows = s.choices.map((c) => formatChoice(c, config.backends));
    const missing = s.unavailable.length ? ` · not available: ${s.unavailable.join(", ")}` : "";
    const choice = await ui.select(`Subagent model — ${s.summary}${missing}${taskLine}`, [...rows, ALL_MODELS], { signal });
    const index = choice === undefined ? -1 : rows.indexOf(choice);
    if (index >= 0) {
      const c = s.choices[index];
      picked = { provider: c.provider, model: c.model };
      route_ = c.route;
      tookTopSuggestion = index === 0;
    } else if (choice === ALL_MODELS) {
      const id = await ui.select(`Subagent model — all models (router: ${s.summary})${taskLine}`, all, { signal });
      if (id) picked = split(id);
    }
  } else if (outcome.reason !== "cancelled") {
    const id = await ui.select(`Subagent model (${outcome.reason})${taskLine}`, all, { signal });
    if (id) picked = split(id);
  }

  // Every routed attempt is logged, including cancellations: they show when suggestions were bad.
  if (outcome.status === "ok" || outcome.reason !== "cancelled") {
    try {
      await deps.logDecision({
        time: deps.now().toISOString(), via: options.via, task, outcome, rankedBy,
        picked: picked ? { ...picked, ...(route_ ? { route: route_ } : {}) } : null,
        tookTopSuggestion,
      });
    } catch (error) {
      ui.warn?.(`Couldn't log routing decision: ${(error as Error).message}`);
    }
  }
  return picked;
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatChoice, loadConfig, logDecision, parseConfig, route, suggest,
  type BackendResult, type RouterConfig,
} from "./router.ts";

const raw = {
  service: "http://127.0.0.1:1",
  backends: ["arch", "laya"],
  primary: "arch",
  routes: {
    debug: { description: "find a bug", models: ["a/fast", "b/strong"] },
    review: { description: "critique code", models: ["b/strong", "a/careful"] },
    explore: { description: "locate code", models: ["c/cheap"] },
  },
};
const config = parseConfig(raw);
const available = [{ provider: "a", id: "fast" }, { provider: "b", id: "strong" }, { provider: "a", id: "careful" }];
const ranked = (...pairs: [string, number][]) => ({ ranked: pairs.map(([route, p]) => ({ route, p })), latencyMs: 1 });

// A real local HTTP server standing in for the router service.
async function serve(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    config: { ...config, service: `http://127.0.0.1:${port}` } as RouterConfig,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
};

test("parses config: defaults, order, trailing slash", () => {
  const c = parseConfig({ ...raw, service: "http://localhost:8765/", primary: undefined, timeoutMs: undefined });
  assert.equal(c.service, "http://localhost:8765");
  assert.equal(c.primary, "arch");
  assert.equal(c.timeoutMs, 3000);
  assert.deepEqual(c.routes.map((r) => r.name), ["debug", "review", "explore"]);
  assert.deepEqual(c.unsure, {});
});

test("rejects bad config", () => {
  const cases: [unknown, RegExp][] = [
    [[], /JSON object/],
    [{ ...raw, service: "https://router.example.com" }, /loopback/],
    [{ ...raw, service: "http://10.0.0.5:8765" }, /loopback/],
    [{ ...raw, service: "not a url" }, /not a URL/],
    [{ ...raw, backends: [] }, /backends must not be empty/],
    [{ ...raw, backends: ["arch", "arch"] }, /duplicates/],
    [{ ...raw, primary: "gpt" }, /primary/],
    [{ ...raw, timeoutMs: 0 }, /timeoutMs/],
    [{ ...raw, routes: {} }, /routes/],
    [{ ...raw, routes: { other: { description: "x", models: ["a/b"] } } }, /added automatically/],
    [{ ...raw, routes: { "Bad Name": { description: "x", models: ["a/b"] } } }, /lowercase/],
    [{ ...raw, routes: { debug: { description: "", models: ["a/b"] } } }, /description/],
    [{ ...raw, routes: { debug: { description: "x".repeat(401), models: ["a/b"] } } }, /description/],
    [{ ...raw, routes: { debug: { description: "x", models: [] } } }, /no models/],
    [{ ...raw, routes: { debug: { description: "x", models: ["nomodel"] } } }, /provider\/model/],
    [{ ...raw, routes: { debug: { description: "x", models: ["a/b", "a/b"] } } }, /duplicates/],
    [{ ...raw, unsure: { gpt: { minP: 0.5 } } }, /unknown backend/],
    [{ ...raw, unsure: { arch: { minP: 2 } } }, /between 0 and 1/],
    [{ ...raw, unsure: { arch: { threshold: 0.5 } } }, /unknown key/],
  ];
  for (const [value, message] of cases) assert.throws(() => parseConfig(value), message, JSON.stringify(value));
});

test("loads config files; a missing file means routing is off", async () => {
  const dir = await mkdtemp(join(tmpdir(), "router-test-"));
  assert.equal(await loadConfig(join(dir, "missing.json")), undefined);
  await writeFile(join(dir, "bad.json"), "{");
  await assert.rejects(loadConfig(join(dir, "bad.json")), /invalid JSON/);
  await writeFile(join(dir, "ok.json"), JSON.stringify(raw));
  assert.deepEqual(await loadConfig(join(dir, "ok.json")), config);
});

test("the shipped config is valid and uses exact provider/model IDs", async () => {
  const shipped = await loadConfig(fileURLToPath(new URL("../../subagent-routes.json", import.meta.url)));
  assert.ok(shipped);
  assert.ok(shipped.routes.length >= 6);
});

test("sends task, routes, and backends; parses results", async () => {
  let request: unknown;
  const s = await serve((req, body, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/route");
    request = JSON.parse(body);
    json(res, 200, { results: {
      arch: { ranked: [{ route: "review", p: 0.9 }, { route: "debug", p: 0.1 }], latency_ms: 300, model: "m" },
      laya: { ranked: [{ route: "debug", p: 0.4 }], latency_ms: 90, truncated: true },
    } });
  });
  try {
    const outcome = await route("look at this", s.config);
    assert.deepEqual(request, {
      task: "look at this",
      routes: config.routes.map(({ name, description }) => ({ name, description })),
      backends: ["arch", "laya"],
    });
    assert.deepEqual(outcome, { status: "ok", results: {
      arch: { ranked: [{ route: "review", p: 0.9 }, { route: "debug", p: 0.1 }], latencyMs: 300 },
      laya: { ranked: [{ route: "debug", p: 0.4 }], latencyMs: 90, truncated: true },
    } });
  } finally { await s.close(); }
});

test("one failed or malformed backend is kept as an error; all failed is unavailable", async () => {
  let results: unknown = {};
  const s = await serve((_req, _body, res) => json(res, 200, { results }));
  try {
    results = { arch: { error: "RuntimeError: MPS" }, laya: { ranked: [{ route: "debug", p: 1 }], latency_ms: 1 } };
    const one = await route("t", s.config);
    assert.equal(one.status, "ok");
    assert.deepEqual(one.status === "ok" && one.results.arch, { error: "RuntimeError: MPS" });

    results = { arch: { error: "boom" }, laya: { ranked: "nope" } };
    const all = await route("t", s.config);
    assert.equal(all.status, "unavailable");
    assert.match(all.status === "unavailable" ? all.reason : "", /every backend failed.*arch: boom.*laya: missing or malformed/);
  } finally { await s.close(); }
});

test("never throws: HTTP errors, bad JSON, refused connections, timeouts, cancellation", async () => {
  const reason = async (c: RouterConfig, signal?: AbortSignal) => {
    const o = await route("t", c, { signal });
    assert.equal(o.status, "unavailable");
    return o.status === "unavailable" ? o.reason : "";
  };
  let mode = "";
  const s = await serve((_req, _body, res) => {
    if (mode === "422") return json(res, 422, { detail: [{ msg: "duplicate route names" }] });
    if (mode === "html") return res.writeHead(500).end("<html>");
    if (mode === "empty") return json(res, 200, {});
    // "slow": never answer
  });
  try {
    mode = "422"; assert.match(await reason(s.config), /HTTP 422.*duplicate route names/);
    mode = "html"; assert.match(await reason(s.config), /invalid JSON \(HTTP 500\)/);
    mode = "empty"; assert.match(await reason(s.config), /no results/);
    mode = "slow"; assert.match(await reason({ ...s.config, timeoutMs: 100 }), /timed out after 100 ms/);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    assert.equal(await reason(s.config, controller.signal), "cancelled");
    assert.equal(await reason(s.config, AbortSignal.abort()), "cancelled");
  } finally { await s.close(); }
  // A port that was just freed and never connected to (so no pooled socket) refuses.
  const closed = await serve(() => {});
  await closed.close();
  assert.match(await reason(closed.config), /not running at http:\/\/127\.0\.0\.1:\d+/);
  const localhost = closed.config.service.replace("127.0.0.1", "localhost");
  assert.match(await reason({ ...closed.config, service: localhost }), /not running at http:\/\/localhost:\d+/);
});

test("suggest orders by the primary ranking, dedupes, and drops unavailable models", () => {
  const results: Record<string, BackendResult> = {
    arch: ranked(["review", 0.7], ["debug", 0.2], ["other", 0.05], ["explore", 0.05]),
    laya: ranked(["debug", 0.5], ["review", 0.3], ["explore", 0.2]),
  };
  const s = suggest(results, config, available);
  assert.deepEqual(s.choices.map((c) => [`${c.provider}/${c.model}`, c.route]), [
    ["b/strong", "review"], ["a/careful", "review"], ["a/fast", "debug"],
  ]);
  assert.deepEqual(s.choices[0].scores, { arch: 0.7, laya: 0.3 });
  assert.equal(s.rankedBy, "arch");
  assert.equal(s.unsure, false);
  assert.deepEqual(s.unavailable, ["c/cheap"]);
  assert.equal(s.summary, "arch: review 0.70 · laya: debug 0.50 (disagree)");
  assert.equal(formatChoice(s.choices[0], config.backends), "b/strong   review   arch 0.70 · laya 0.30");
});

test("suggest falls back to another backend when the primary failed", () => {
  const s = suggest({ arch: { error: "boom" }, laya: ranked(["debug", 0.6], ["review", 0.4]) }, config, available);
  assert.equal(s.rankedBy, "laya");
  assert.equal(s.choices[0].route, "debug");
  assert.deepEqual(s.choices[0].scores, { arch: undefined, laya: 0.6 });
  assert.match(s.summary, /^arch: failed · laya: debug 0\.60 · ranked by laya$/);
  assert.match(formatChoice(s.choices[0], config.backends), /arch – · laya 0\.60$/);
});

test("unsure when other ranks first or a backend's rule fails; truncation is shown", () => {
  const c = parseConfig({ ...raw, unsure: { arch: { minP: 0.6 }, laya: { minMargin: 0.1 } } });
  const u = (arch: BackendResult, laya: BackendResult = ranked(["debug", 1])) => suggest({ arch, laya }, c, available);
  assert.equal(u(ranked(["other", 0.8], ["debug", 0.2])).unsure, true);
  assert.equal(u(ranked(["other", 0.8], ["debug", 0.2])).choices[0].route, "debug"); // still offered
  assert.equal(u(ranked(["debug", 0.5], ["review", 0.5])).unsure, true); // below minP
  assert.equal(u(ranked(["debug", 0.7], ["review", 0.3])).unsure, false);
  const byLaya = u({ error: "x" }, { ...ranked(["debug", 0.4], ["review", 0.35]), truncated: true });
  assert.equal(byLaya.unsure, true); // margin 0.05 < 0.1
  assert.match(byLaya.summary, /laya: debug 0\.40 \(truncated\).*unsure$/);
});

test("suggest requires a successful backend", () => {
  assert.throws(() => suggest({ arch: { error: "a" }, laya: { error: "b" } }, config, available));
});

test("decision log is appended and private", async () => {
  const dir = await mkdtemp(join(tmpdir(), "router-log-"));
  const path = join(dir, "router", "decisions.jsonl");
  const entry = {
    time: "2026-09-30T00:00:00Z", task: "t", outcome: { status: "unavailable", reason: "x" } as const,
    picked: { provider: "a", model: "fast" }, tookTopSuggestion: false,
  };
  await logDecision(entry, path);
  await logDecision({ ...entry, picked: null }, path);
  const lines = (await readFile(path, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [entry, { ...entry, picked: null }]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, "router"))).mode & 0o777, 0o700);
});

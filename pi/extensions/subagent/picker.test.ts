import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_MODELS, pickModel, taskPreview, type PickDeps } from "./picker.ts";
import { parseConfig, type Decision, type RouteOutcome } from "./router.ts";

const config = parseConfig({
  service: "http://127.0.0.1:8765",
  backends: ["arch", "laya"],
  routes: {
    debug: { description: "find a bug", models: ["a/fast", "b/strong"] },
    review: { description: "critique code", models: ["b/strong", "c/gone"] },
  },
});
const available = [{ provider: "b", id: "strong" }, { provider: "a", id: "fast" }, { provider: "z", id: "extra" }];
const ok: RouteOutcome = { status: "ok", results: {
  arch: { ranked: [{ route: "review", p: 0.8 }, { route: "debug", p: 0.2 }], latencyMs: 1 },
  laya: { ranked: [{ route: "debug", p: 0.6 }, { route: "review", p: 0.4 }], latencyMs: 1 },
} };

/** A fake UI that answers each select with the next scripted function of its options. */
function harness(answers: ((options: string[]) => string | undefined)[], deps: Partial<PickDeps> = {}) {
  const selects: { title: string; options: string[] }[] = [];
  const statuses: (string | undefined)[] = [];
  const warnings: string[] = [];
  const logged: Decision[] = [];
  const ui = {
    select: async (title: string, options: string[]) => {
      selects.push({ title, options });
      const answer = answers.shift();
      assert.ok(answer, `unexpected select: ${title}`);
      return answer(options);
    },
    status: (text: string | undefined) => { statuses.push(text); },
    warn: (text: string) => { warnings.push(text); },
  };
  const allDeps: Partial<PickDeps> = {
    loadConfig: async () => config,
    route: async () => ok,
    logDecision: async (d) => { logged.push(d); },
    now: () => new Date("2026-09-30T12:00:00Z"),
    ...deps,
  };
  const pick = (via: "command" | "tool" = "command", signal?: AbortSignal) =>
    pickModel("find the race", ui, available, { via, signal, deps: allDeps });
  return { pick, selects, statuses, warnings, logged };
}

test("suggestions first, then All models; the top pick is logged with its route", async () => {
  const h = harness([(o) => o[0]]);
  assert.deepEqual(await h.pick("tool"), { provider: "b", model: "strong" });
  assert.equal(h.selects.length, 1);
  const { title, options } = h.selects[0];
  assert.equal(title, "Subagent model — arch: review 0.80 · laya: debug 0.60 (disagree) · not available: c/gone\nTask: find the race");
  assert.deepEqual(options, [
    "b/strong   review   arch 0.80 · laya 0.40",
    "a/fast   debug   arch 0.20 · laya 0.60",
    ALL_MODELS,
  ]);
  assert.deepEqual(h.statuses, ["Routing subagent task…", undefined]);
  assert.deepEqual(h.logged, [{
    time: "2026-09-30T12:00:00.000Z", via: "tool", task: "find the race", outcome: ok, rankedBy: "arch",
    picked: { provider: "b", model: "strong", route: "review" }, tookTopSuggestion: true,
  }]);
});

test("a lower suggestion isn't the top pick", async () => {
  const h = harness([(o) => o[1]]);
  assert.deepEqual(await h.pick(), { provider: "a", model: "fast" });
  assert.equal(h.logged[0].tookTopSuggestion, false);
  assert.equal(h.logged[0].picked?.route, "debug");
});

test("All models opens the full list; the pick has no route", async () => {
  const h = harness([() => ALL_MODELS, (o) => o.find((x) => x === "z/extra")]);
  assert.deepEqual(await h.pick(), { provider: "z", model: "extra" });
  assert.deepEqual(h.selects[1].options, ["a/fast", "b/strong", "z/extra"]);
  assert.match(h.selects[1].title, /all models \(router: arch: review/);
  assert.deepEqual(h.logged[0].picked, { provider: "z", model: "extra" });
  assert.equal(h.logged[0].tookTopSuggestion, false);
});

test("cancelling is logged as no pick", async () => {
  const h = harness([() => undefined]);
  assert.equal(await h.pick(), undefined);
  assert.equal(h.logged[0].picked, null);
});

test("router unavailable: full list with the reason, still logged", async () => {
  const outcome: RouteOutcome = { status: "unavailable", reason: "router not running at http://127.0.0.1:8765" };
  const h = harness([(o) => o[0]], { route: async () => outcome });
  assert.deepEqual(await h.pick(), { provider: "a", model: "fast" });
  assert.equal(h.selects[0].title, "Subagent model (router not running at http://127.0.0.1:8765)\nTask: find the race");
  assert.deepEqual(h.selects[0].options, ["a/fast", "b/strong", "z/extra"]);
  assert.deepEqual(h.logged[0].outcome, outcome);
  assert.equal(h.logged[0].rankedBy, undefined);
});

test("cancelled while routing: no picker, no log", async () => {
  const h = harness([], { route: async () => ({ status: "unavailable", reason: "cancelled" }) });
  assert.equal(await h.pick(), undefined);
  assert.equal(h.selects.length, 0);
  assert.equal(h.logged.length, 0);
  assert.deepEqual(h.statuses, ["Routing subagent task…", undefined]);
});

test("no config: plain picker, nothing routed or logged", async () => {
  let routed = false;
  const h = harness([(o) => o[2]], { loadConfig: async () => undefined, route: async () => { routed = true; return ok; } });
  assert.deepEqual(await h.pick(), { provider: "z", model: "extra" });
  assert.equal(h.selects[0].title, "Subagent model\nTask: find the race");
  assert.equal(routed, false);
  assert.equal(h.logged.length, 0);
});

test("broken config warns and falls back instead of blocking the job", async () => {
  const h = harness([(o) => o[0]], { loadConfig: async () => { throw new Error("subagent-routes.json: bad"); } });
  assert.deepEqual(await h.pick(), { provider: "a", model: "fast" });
  assert.deepEqual(h.warnings, ["Model routing off: subagent-routes.json: bad"]);
});

test("a failed log write warns but keeps the pick", async () => {
  const h = harness([(o) => o[0]], { logDecision: async () => { throw new Error("EACCES"); } });
  assert.deepEqual(await h.pick(), { provider: "b", model: "strong" });
  assert.deepEqual(h.warnings, ["Couldn't log routing decision: EACCES"]);
});

test("no available models is an error", async () => {
  await assert.rejects(pickModel("t", { select: async () => undefined }, [], { via: "tool" }), /No available models/);
});

test("task preview is one line and bounded", () => {
  assert.equal(taskPreview("  look at\n\n  this\tdiff "), "look at this diff");
  const long = taskPreview("x".repeat(500));
  assert.equal(long.length, 240);
  assert.ok(long.endsWith("…"));
});

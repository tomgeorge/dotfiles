import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { buildSpec, parseArgs, parseDuration, Registry, tail, type EndReason, type RunResult, type Watch, type WatchSpec } from "./watcher.ts";

const result = (code: number, stdout = ""): RunResult => ({ code, stdout, stderr: "", killed: false });

function harness(results: RunResult[] | (() => Promise<RunResult>)) {
  const fired: Array<{ id: number; result?: RunResult }> = [];
  const ended: Array<{ id: number; reason: EndReason; detail?: string }> = [];
  let calls = 0;
  const registry = new Registry(
    async () => typeof results === "function" ? results() : results[Math.min(calls++, results.length - 1)],
    {
      onFire: (w, r) => fired.push({ id: w.id, result: r }),
      onEnd: (w, reason, detail) => ended.push({ id: w.id, reason, detail }),
      onUpdate: () => {},
    },
  );
  return { registry, fired, ended, calls: () => calls };
}

const spec = (over: Partial<WatchSpec> = {}): WatchSpec => ({
  kind: "command", text: "check", description: "d", cwd: "/", intervalMs: 5,
  timeoutMs: 1_000, until: "success", deliver: "wake", ...over,
});

test("success: keeps checking until exit 0, then fires once and ends", async () => {
  const h = harness([result(8, "pending"), result(8, "pending"), result(0, "pass")]);
  h.registry.start(spec());
  await sleep(60);
  assert.equal(h.calls(), 3);
  assert.deepEqual(h.fired.map((f) => f.result?.stdout), ["pass"]);
  assert.deepEqual(h.ended.map((e) => e.reason), ["met"]);
  assert.equal(h.registry.list().length, 0);
});

test("change: baseline is silent, each change fires, runs until timeout", async () => {
  const h = harness([result(0, "ok"), result(0, "ok"), result(1, "ALERT"), result(1, "ALERT"), result(0, "ok")]);
  h.registry.start(spec({ until: "change", timeoutMs: 80 }));
  await sleep(150);
  assert.deepEqual(h.fired.map((f) => f.result?.stdout), ["ALERT", "ok"]);
  assert.deepEqual(h.ended.map((e) => e.reason), ["timeout"]);
});

test("command not found ends with an error instead of retrying", async () => {
  const h = harness([{ code: 127, stdout: "", stderr: "bash: nope: command not found", killed: false }]);
  h.registry.start(spec());
  await sleep(30);
  assert.equal(h.calls(), 1);
  assert.equal(h.ended[0].reason, "error");
  assert.match(h.ended[0].detail!, /command not found/);
});

test("stop aborts a running check and suppresses its result", async () => {
  let signal: AbortSignal | undefined;
  const fired: Watch[] = [];
  const ended: EndReason[] = [];
  const registry = new Registry(
    (_c, _cwd, s) => { signal = s; return sleep(30).then(() => result(0)); },
    { onFire: (w) => fired.push(w), onEnd: (_w, r) => ended.push(r), onUpdate: () => {} },
  );
  const watch = registry.start(spec());
  assert.ok(registry.stop(watch.id));
  assert.equal(signal?.aborted, true);
  await sleep(50);
  assert.deepEqual(fired, []);
  assert.deepEqual(ended, ["stopped"]);
  assert.equal(registry.stop(watch.id), false);
});

test("prompt loop waits for rearm before scheduling the next iteration", async () => {
  const h = harness([]);
  const watch = h.registry.start(spec({ kind: "prompt", intervalMs: 10 }));
  await sleep(40);
  assert.equal(h.fired.length, 1, "no second iteration while the first is undelivered");
  assert.equal(watch.state, "due");
  h.registry.rearm(watch.id);
  await sleep(25);
  assert.equal(h.fired.length, 2);
  h.registry.stopAll();
});

test("ids number active watches, reusing the lowest free one", async () => {
  const h = harness([result(1)]);
  const a = h.registry.start(spec({ timeoutMs: 60_000 }));
  const b = h.registry.start(spec({ timeoutMs: 60_000 }));
  const c = h.registry.start(spec({ timeoutMs: 60_000 }));
  assert.deepEqual([a.id, b.id, c.id], [1, 2, 3]);
  h.registry.stop(1);
  assert.equal(h.registry.start(spec({ timeoutMs: 60_000 })).id, 1);
  assert.equal(h.registry.start(spec({ timeoutMs: 60_000 })).id, 4);
  h.registry.stopAll();
});

test("firstCheck resolves with the first result, even if the watch ends on it", async () => {
  const pending = harness([result(1, ""), result(0)]);
  const w = pending.registry.start(spec({ timeoutMs: 60_000, intervalMs: 60_000 }));
  assert.equal((await pending.registry.firstCheck(w.id))?.code, 1);
  pending.registry.stopAll();

  const broken = harness([{ code: 127, stdout: "", stderr: "nope", killed: false }]);
  const first = broken.registry.firstCheck(broken.registry.start(spec()).id);
  assert.equal((await first)?.code, 127);
  assert.equal(broken.ended[0].reason, "error");

  const loop = harness([]);
  const l = loop.registry.start(spec({ kind: "prompt", intervalMs: 60_000 }));
  const resolved = loop.registry.firstCheck(l.id);
  loop.registry.stop(l.id);
  assert.equal(await resolved, undefined);
});

test("change reports keep the previous result", async () => {
  const h = harness([result(1, ""), result(0, "a")]);
  const w = h.registry.start(spec({ until: "change", timeoutMs: 60_000, intervalMs: 20 }));
  await sleep(30);
  assert.equal(h.fired.length, 1);
  assert.equal(w.previous?.code, 1);
  assert.equal(w.last?.code, 0);
  h.registry.stopAll();
});

test("parseDuration", () => {
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("5m"), 300_000);
  assert.equal(parseDuration("1.5h"), 5_400_000);
  assert.equal(parseDuration("45"), 45_000);
  assert.equal(parseDuration(10), 10_000);
  assert.throws(() => parseDuration("soon"));
  assert.throws(() => parseDuration("0s"));
});

test("buildSpec validates and applies defaults", () => {
  assert.deepEqual(
    { ...buildSpec({ command: "gh pr checks" }, "/repo") },
    { kind: "command", text: "gh pr checks", cwd: "/repo", intervalMs: 30_000, timeoutMs: 3_600_000, description: "gh pr checks", until: "success", deliver: "wake" },
  );
  assert.equal(buildSpec({ prompt: "check slack" }, "/").intervalMs, 600_000);
  assert.throws(() => buildSpec({}, "/"), /exactly one/);
  assert.throws(() => buildSpec({ command: "a", prompt: "b" }, "/"), /exactly one/);
  assert.throws(() => buildSpec({ command: "a", interval: "1s" }, "/"), /at least 5s/);
  assert.throws(() => buildSpec({ prompt: "a", interval: "30s" }, "/"), /at least 1m/);
  assert.throws(() => buildSpec({ prompt: "a", deliver: "steer" }, "/"), /only to command/);
  assert.throws(() => buildSpec({ command: "a", timeout: "2d" }, "/"), /at most 24h/);
});

test("parseArgs takes leading options and leaves the command intact", () => {
  assert.deepEqual(parseArgs("1m --change --notify --timeout 2h kubectl get pods -A --watch-only", "command"), {
    interval: "1m", until: "change", deliver: "notify", timeout: "2h", command: "kubectl get pods -A --watch-only",
  });
  assert.deepEqual(parseArgs("--timeout=30m -- --change is part of it", "command"), { timeout: "30m", command: "--change is part of it" });
  assert.deepEqual(parseArgs("15m did the deploy finish?", "prompt"), { interval: "15m", prompt: "did the deploy finish?" });
  // /watch-only flags are prompt text in /loop.
  assert.deepEqual(parseArgs("--notify me later", "prompt"), { prompt: "--notify me later" });
  assert.throws(() => parseArgs("30s", "command"), /Usage/);
});

test("tail keeps the end of long output", () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const out = tail(long, 3);
  assert.match(out, /^\[\.\.\.earlier output omitted\]\nline 97\nline 98\nline 99$/);
  assert.equal(tail("short\n"), "short");
});

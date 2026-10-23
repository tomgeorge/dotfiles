import assert from "node:assert/strict";
import { test } from "node:test";
import { ENDED_LIMIT, LOG_LIMIT, WatchStore } from "./store.ts";
import type { RunResult, Watch } from "./watcher.ts";

const result = (code: number, stdout = "", stderr = ""): RunResult => ({ code, stdout, stderr, killed: false });

function watch(id: number, over: Partial<Watch> = {}): Watch {
  return {
    kind: "command", text: `check ${id}`, description: `watch ${id}`, cwd: "/tmp", intervalMs: 30_000,
    timeoutMs: 3_600_000, until: "success", deliver: "wake", id, startedAt: 0, deadline: 3_600_000,
    checks: 0, fires: 0, state: "waiting", ...over,
  };
}

function storeWith(n: number) {
  const store = new WatchStore();
  const watches = Array.from({ length: n }, (_, i) => watch(i + 1));
  for (const w of watches) store.add(w, 0);
  return { store, watches };
}

test("store logs each new check once and collapses repeats", () => {
  const { store, watches: [w] } = storeWith(1);
  w.checks = 1;
  w.last = result(8, "pending\n");
  store.sync(w, 1000);
  store.sync(w, 1500); // same result object: not logged again
  w.checks = 2;
  w.last = result(8, "pending\n");
  store.sync(w, 2000);
  w.last = result(0, "pass\n");
  store.sync(w, 3000);
  w.last = result(0, "build pending\npass\n"); // same last line, different output
  store.sync(w, 4000);
  w.last = result(0, "a\tb\n");
  store.sync(w, 5000);
  const log = store.list()[0].log;
  assert.deepEqual(log.map((e) => [e.text, e.repeat]), [
    ["started", 1], ["check · exit 8 · pending", 2], ["check · exit 0 · pass", 1], ["check · exit 0 · build pending", 1],
    ["check · exit 0 · a b", 1],
  ]);
  assert.equal(log[1].at, 2000);
  for (let i = 0; i < LOG_LIMIT + 10; i++) store.note(w, `note ${i}`);
  assert.equal(store.list()[0].log.length, LOG_LIMIT);
});

test("store keeps ended watches, distinct from a reused id, and caps them", () => {
  const store = new WatchStore();
  const first = watch(1);
  store.add(first, 0);
  store.end(first, "timeout", undefined, 5000);
  const reused = watch(1);
  store.add(reused, 6000);
  const [a, b] = store.list();
  assert.equal(a.ended?.reason, "timeout");
  assert.equal(b.ended, undefined);
  assert.notEqual(a.key, b.key);
  assert.equal(store.active().length, 1);
  for (let i = 0; i < ENDED_LIMIT + 5; i++) {
    const w = watch(2);
    store.add(w);
    store.end(w, "stopped");
  }
  assert.equal(store.list().filter((r) => r.ended).length, ENDED_LIMIT);
  assert.ok(store.get(b.key), "active watches are never pruned");
});

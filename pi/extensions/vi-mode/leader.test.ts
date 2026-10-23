import assert from "node:assert/strict";
import { test } from "node:test";
import { leaderKey, opensLeader, type LeaderTree } from "./leader.ts";
import { LeaderRegistry } from "./leaderRegistry.ts";

const registry = (): LeaderRegistry => {
  const r = new LeaderRegistry([
    { id: "model.select", path: [{ key: "m", label: "models" }, { key: "m", label: "select" }], target: { app: "app.model.select" } },
    { id: "quit", path: [{ key: "q", label: "quit" }], target: { command: { name: "quit" } } },
  ]);
  r.register({ source: "crew", bindings: [{ id: "list", path: [{ key: "c", label: "crew" }, { key: "l", label: "list" }], command: { name: "crews" } }] });
  return r;
};

test("opensLeader: only NORMAL mode, nothing pending, the leader key", () => {
  const open = { mode: "normal", pending: "", key: " ", leaderKey: " " } as const;
  assert.equal(opensLeader(open), true);
  assert.equal(opensLeader({ ...open, mode: "insert" }), false, "INSERT types the key");
  assert.equal(opensLeader({ ...open, pending: "d" }), false, "d SPC is an operator's motion");
  assert.equal(opensLeader({ ...open, pending: "f" }), false, "f SPC finds a space");
  assert.equal(opensLeader({ ...open, key: "x" }), false, "not the leader key");
  assert.equal(opensLeader({ ...open, key: " ", leaderKey: "\\" }), false, "space isn't the leader when \\ is");
  assert.equal(opensLeader({ ...open, key: "\\", leaderKey: "\\" }), true, "a custom leader key");
  assert.equal(opensLeader({ ...open, key: "\\", leaderKey: "\\", mode: "insert" }), false);
});

test("a group key descends", () => {
  assert.deepEqual(leaderKey(registry(), [], "c"), { type: "descend", path: ["c"] });
});

test("a leaf key runs its target with the full path", () => {
  const r = registry();
  assert.deepEqual(leaderKey(r, ["c"], "l"), { type: "run", target: { command: { name: "crews" } }, path: ["c", "l"] });
  assert.deepEqual(leaderKey(r, ["m"], "m"), { type: "run", target: { app: "app.model.select" }, path: ["m", "m"] });
  assert.deepEqual(leaderKey(r, [], "q"), { type: "run", target: { command: { name: "quit" } }, path: ["q"] });
});

test("upper case is lower-cased before lookup", () => {
  const r = registry();
  assert.deepEqual(leaderKey(r, [], "C"), { type: "descend", path: ["c"] });
  assert.deepEqual(leaderKey(r, ["c"], "L"), { type: "run", target: { command: { name: "crews" } }, path: ["c", "l"] });
});

test("backspace goes up one level, and closes at the root", () => {
  const r = registry();
  assert.deepEqual(leaderKey(r, ["c"], "backspace"), { type: "descend", path: [] });
  assert.deepEqual(leaderKey(r, [], "backspace"), { type: "close" });
});

test("backspace closes when the parent group is gone", () => {
  const stub: LeaderTree = { group: (path) => (path.length === 0 ? undefined : { label: "x", options: [] }) };
  assert.deepEqual(leaderKey(stub, ["c"], "backspace"), { type: "close" });
});

test("escape closes, at the root and below it", () => {
  const r = registry();
  assert.deepEqual(leaderKey(r, [], "escape"), { type: "close" });
  assert.deepEqual(leaderKey(r, ["c"], "escape"), { type: "close" });
});

test("an unknown key closes with the path that missed", () => {
  const r = registry();
  assert.deepEqual(leaderKey(r, ["c"], "z"), { type: "close", missed: ["c", "z"] });
  assert.deepEqual(leaderKey(r, [], "Z"), { type: "close", missed: ["z"] });
  assert.deepEqual(leaderKey(r, [], " "), { type: "close", missed: [" "] });
});

test("a key under a path that's no longer a group misses", () => {
  assert.deepEqual(leaderKey(registry(), ["x"], "l"), { type: "close", missed: ["x", "l"] });
});

test("an input that isn't one character closes with nothing to show", () => {
  assert.deepEqual(leaderKey(registry(), ["c"], "\x1b[A"), { type: "close" });
  assert.deepEqual(leaderKey(registry(), ["c"], ""), { type: "close" });
});

test("works against a stub tree", () => {
  const stub: LeaderTree = { group: () => ({ label: "root", options: [{ key: "a", label: "a", hasChildren: false, target: { command: { name: "a" } } }] }) };
  assert.deepEqual(leaderKey(stub, [], "a"), { type: "run", target: { command: { name: "a" } }, path: ["a"] });
});

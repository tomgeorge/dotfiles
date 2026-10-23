import assert from "node:assert/strict";
import { test } from "node:test";
import { fakePi } from "../test-support/fake-pi.ts";
import { LEADER_CONTRIBUTE, LEADER_DISCOVER } from "../vi-mode/leaderContract.ts";

// After fake-pi registers its module stubs.
const { default: subagentExtension } = await import("./index.ts");

const expected = {
  source: "subagent",
  bindings: [{
    id: "subagent.list",
    path: [{ key: "a", label: "agents" }, { key: "l", label: "list" }],
    command: { name: "subagents" },
  }],
};

test("contributes the agents leader group on load and again on leader:discover", () => {
  const f = fakePi();
  const seen: unknown[] = [];
  f.events.on(LEADER_CONTRIBUTE, (data) => seen.push(data));
  subagentExtension(f.pi);
  assert.deepEqual(seen, [expected]);
  f.events.emit(LEADER_DISCOVER, undefined);
  assert.deepEqual(seen, [expected, expected]);
  // The binding's target exists.
  assert.ok(f.commands.has("subagents"));
});

test("registers no shortcut", () => {
  const f = fakePi();
  subagentExtension(f.pi);
  assert.equal(f.shortcuts.size, 0);
});

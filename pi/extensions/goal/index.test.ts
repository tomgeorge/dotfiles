import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakePi } from "../test-support/fake-pi.ts";

// After fake-pi registers its module stubs.
const { default: goalExtension } = await import("./index.ts");

// Each check appends to `runs`, and passes once `done` exists.
const CHECK = "echo run >> runs; test -f done";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "goal-wiring-"));
  const f = fakePi();
  goalExtension(f.pi);
  const ctx = f.ctx(dir);
  const runs = () => (existsSync(join(dir, "runs")) ? readFileSync(join(dir, "runs"), "utf8").split("\n").filter(Boolean).length : 0);
  /** One agent run: `tools` tool calls, then an assistant message ending with `stop`. */
  async function agentRun(tools: number, stop = "stop", extra: Record<string, unknown> = {}) {
    await f.emit("agent_start", {}, ctx);
    for (let i = 0; i < tools; i++) await f.emit("tool_execution_start", {}, ctx);
    await f.emit("message_end", { message: { role: "assistant", stopReason: stop } }, { ...ctx, ...extra });
    await f.emit("agent_settled", {}, ctx);
  }
  const last = () => f.sent.at(-1)!;
  const state = () => f.entries.at(-1)?.data as { status: string; continuations: number } | undefined;
  return { dir, f, ctx, runs, agentRun, last, state };
}

test("setting a goal wakes the agent and declares goal_park", async () => {
  const { f, ctx, last, state } = setup();
  await f.emit("session_start", {}, ctx);
  assert.ok(!f.active().includes("goal_park"), "no goal_park without a goal");
  await f.command("goal", `fix it --check ${CHECK} --max 3`, ctx);
  assert.equal(state()?.status, "active");
  assert.equal(last().options?.triggerTurn, true);
  assert.match(last().message.content, /fix it/);
  assert.ok(f.active().includes("goal_park"));
});

test("a failing check continues the run with its output; a passing one completes", async () => {
  const { dir, f, ctx, runs, agentRun, last, state } = setup();
  await f.emit("session_start", {}, ctx);
  await f.command("goal", `fix it --check ${CHECK} --max 3`, ctx);
  await agentRun(2);
  assert.equal(runs(), 1);
  assert.equal(state()?.continuations, 1);
  assert.equal(last().options?.triggerTurn, true);
  assert.match(last().message.content, /continuation 1\/3/);
  assert.equal((f.entries[0].data as { continuations: number }).continuations, 0, "saved entries are snapshots");
  writeFileSync(join(dir, "done"), "");
  await agentRun(1);
  assert.equal(state()?.status, "complete");
  assert.notEqual(last().options?.triggerTurn, true, "completion doesn't wake the agent");
  assert.ok(!f.active().includes("goal_park"));
});

test("an interrupted run pauses without running the check", async () => {
  for (const interrupt of [{ stop: "aborted", extra: {} }, { stop: "error", extra: { signal: AbortSignal.abort() } }]) {
    const { f, ctx, runs, agentRun, state } = setup();
    await f.emit("session_start", {}, ctx);
    await f.command("goal", `fix it --check ${CHECK}`, ctx);
    await agentRun(3, interrupt.stop, interrupt.extra);
    assert.equal(state()?.status, "paused", interrupt.stop);
    assert.equal(runs(), 0, "check skipped");
  }
});

test("a run with no tool calls parks; an errored run pauses; the budget stops", async () => {
  {
    const { f, ctx, agentRun, state } = setup();
    await f.emit("session_start", {}, ctx);
    await f.command("goal", `fix it --check ${CHECK}`, ctx);
    await agentRun(2);
    assert.equal(state()?.status, "active");
    await agentRun(0); // the count restarts each run
    assert.equal(state()?.status, "parked");
  }
  {
    const { f, ctx, agentRun, state } = setup();
    await f.emit("session_start", {}, ctx);
    await f.command("goal", `fix it --check ${CHECK}`, ctx);
    await agentRun(2, "error");
    assert.equal(state()?.status, "paused");
  }
  {
    const { f, ctx, agentRun, state } = setup();
    await f.emit("session_start", {}, ctx);
    await f.command("goal", `fix it --check ${CHECK} --max 1`, ctx);
    await agentRun(1);
    await agentRun(1);
    assert.equal(state()?.status, "budget");
    // Resuming after the budget grants a fresh one.
    await f.command("goal", "resume", ctx);
    assert.deepEqual([state()?.status, state()?.continuations], ["active", 0]);
  }
});

test("goal_park parks the active goal", async () => {
  const { f, ctx, state } = setup();
  await f.emit("session_start", {}, ctx);
  await assert.rejects(f.tool("goal_park", { reason: "r", needed: "n" }), /No active goal/);
  await f.command("goal", `fix it --check ${CHECK}`, ctx);
  await f.tool("goal_park", { reason: "need creds", needed: "an API key" });
  assert.equal(state()?.status, "parked");
  assert.ok(!f.active().includes("goal_park"));
});

test("a goal cleared or replaced while its check runs gets no verdict", async () => {
  for (const change of ["clear", `other goal --check ${CHECK}`]) {
    const { f, ctx, state } = setup();
    await f.emit("session_start", {}, ctx);
    await f.command("goal", "fix it --check sleep 0.3; exit 1", ctx);
    await f.emit("agent_start", {}, ctx);
    await f.emit("tool_execution_start", {}, ctx);
    await f.emit("message_end", { message: { role: "assistant", stopReason: "stop" } }, ctx);
    const settled = f.emit("agent_settled", {}, ctx);
    await new Promise((done) => setTimeout(done, 50));
    await f.command("goal", change, ctx);
    const sentAfterChange = f.sent.length;
    await settled;
    assert.equal(f.sent.length, sentAfterChange, `no verdict on the old goal after "${change}"`);
    assert.equal(state()?.status, change === "clear" ? "cleared" : "active");
  }
});

test("the branch's latest goal entry is loaded, past other extensions' entries, and mutating it leaves the entry alone", async () => {
  const { f, ctx } = setup();
  await f.emit("session_start", {}, ctx);
  await f.command("goal", `fix it --check ${CHECK} --max 3`, ctx);
  const saved = f.entries.at(-1)!;
  // A new session over the same branch picks the goal up.
  const g = fakePi();
  goalExtension(g.pi);
  g.entries.push(...f.entries);
  // Another extension's later entry isn't a goal entry, so it can't replace or drop the goal.
  g.entries.push({ type: "custom", customType: "other-state", data: { status: "bogus" } });
  const ctx2 = g.ctx(ctx.cwd);
  await g.emit("session_start", {}, ctx2);
  assert.ok(g.active().includes("goal_park"));
  await g.emit("agent_start", {}, ctx2);
  await g.emit("tool_execution_start", {}, ctx2);
  await g.emit("message_end", { message: { role: "assistant", stopReason: "stop" } }, ctx2);
  await g.emit("agent_settled", {}, ctx2);
  assert.equal((saved.data as { continuations: number }).continuations, 0, "the old entry is unchanged");
  assert.equal((g.entries.at(-1)!.data as { continuations: number }).continuations, 1);
});

test("a malformed latest goal entry leaves no goal, without resurrecting the earlier one", async () => {
  const { f, ctx } = setup();
  await f.emit("session_start", {}, ctx);
  await f.command("goal", `fix it --check ${CHECK}`, ctx);
  f.entries.push({ type: "custom", customType: "goal-state", data: { status: "bogus" } });
  await f.emit("session_start", {}, ctx);
  assert.ok(!f.active().includes("goal_park"), "the earlier active goal stays dropped");
  await f.command("goal", "status", ctx);
  assert.match(f.notes.at(-1)!, /^No goal/);
});

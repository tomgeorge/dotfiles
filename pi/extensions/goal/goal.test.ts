import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { continuationMessage, decide, goalPrompt, newGoal, parseGoalArgs, runCheck, statusLine } from "./goal.ts";

test("parses objective, check (rest of line), max, and lifecycle words", () => {
  assert.deepEqual(parseGoalArgs(""), { kind: "status" });
  assert.deepEqual(parseGoalArgs(" pause "), { kind: "pause" });
  assert.deepEqual(parseGoalArgs("make tests pass --check npm test -- --grep auth"),
    { kind: "set", objective: "make tests pass", check: "npm test -- --grep auth", max: undefined });
  assert.deepEqual(parseGoalArgs("speed up p95 --max 5 --check ./bench.sh --under 120"),
    { kind: "set", objective: "speed up p95", check: "./bench.sh --under 120", max: 5 });
  assert.deepEqual(parseGoalArgs("fix it --check node --test --max 4"),
    { kind: "set", objective: "fix it", check: "node --test", max: 4 });
  assert.deepEqual(parseGoalArgs("just an objective"), { kind: "set", objective: "just an objective", check: undefined, max: undefined });
  assert.throws(() => parseGoalArgs("x --max zero --check y"), /--max/);
});

test("a goal needs an objective and a check", () => {
  assert.throws(() => newGoal("", "true"), /objective/);
  assert.throws(() => newGoal("x", " "), /check/);
  assert.equal(newGoal(" x ", " npm test ").check, "npm test");
});

test("decide: the check decides done; no-progress runs park; budget stops; interrupts pause", () => {
  const g = newGoal("x", "true", 2);
  assert.deepEqual(decide(g, { checkPassed: true, toolCalls: 0, aborted: false }), { action: "complete" });
  assert.equal(decide(g, { checkPassed: false, toolCalls: 3, aborted: false }).action, "continue");
  assert.equal(decide(g, { checkPassed: false, toolCalls: 0, aborted: false }).action, "park");
  assert.equal(decide(g, { checkPassed: false, toolCalls: 3, aborted: true }).action, "pause");
  assert.match((decide(g, { checkPassed: false, toolCalls: 0, aborted: false, errored: true }) as { reason: string }).reason, /error/);
  assert.equal(decide({ ...g, continuations: 2 }, { checkPassed: false, toolCalls: 3, aborted: false }).action, "budget");
  assert.equal(decide({ ...g, status: "paused" }, { checkPassed: true, toolCalls: 1, aborted: false }).action, "none");
});

test("prompts carry the objective, check, budget, and check output", () => {
  const g = { ...newGoal("fix flaky test", "npm test", 5), continuations: 2, lastCheck: { exit: 1, tail: "1 failing", timedOut: false, at: 0 } };
  assert.match(goalPrompt(g), /fix flaky test[\s\S]*npm test[\s\S]*Never weaken[\s\S]*2\/5/);
  assert.match(continuationMessage(g), /continuation 2\/5[\s\S]*exited 1:\n1 failing/);
  assert.match(statusLine(g), /\[active\] fix flaky test[\s\S]*2\/5 continuations · last check exit 1/);
  assert.match(statusLine(undefined), /No goal/);
});

test("runCheck reports exit codes and times out", async () => {
  assert.equal((await runCheck(tmpdir(), "exit 0", 5000)).exit, 0);
  const bad = await runCheck(tmpdir(), "echo nope; exit 2", 5000);
  assert.deepEqual([bad.exit, bad.tail.trim()], [2, "nope"]);
  assert.equal((await runCheck(tmpdir(), "sleep 5", 150)).timedOut, true);
});

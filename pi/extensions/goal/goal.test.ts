import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { continuationMessage, decide, GOAL_GUIDELINES, goalFromEntry, newGoal, parseGoalArgs, runCheck, startMessage, statusLine } from "./goal.ts";

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
  assert.deepEqual(decide(g, { checkPassed: false, toolCalls: 0, aborted: false }), { action: "stop", status: "parked", reason: "the last run made no tool calls, so it wasn't making progress" });
  assert.deepEqual(decide(g, { checkPassed: false, toolCalls: 3, aborted: true }), { action: "stop", status: "paused", reason: "you interrupted the run" });
  const errored = decide(g, { checkPassed: false, toolCalls: 0, aborted: false, errored: true });
  assert.ok(errored.action === "stop" && errored.status === "paused" && /error/.test(errored.reason));
  assert.deepEqual(decide({ ...g, continuations: 2 }, { checkPassed: false, toolCalls: 3, aborted: false }), { action: "stop", status: "budget", reason: "used all 2 automatic continuations" });
  assert.equal(decide({ ...g, status: "paused" }, { checkPassed: true, toolCalls: 1, aborted: false }).action, "none");
});

test("goalFromEntry copies goal-shaped entry data and rejects anything else", () => {
  const g = newGoal("x", "true");
  const loaded = goalFromEntry(g);
  assert.deepEqual(loaded, g);
  assert.notEqual(loaded, g);
  for (const bad of [undefined, null, "x", {}, { ...g, status: "done" }, { ...g, check: 1 }, { ...g, objective: undefined }, { ...g, continuations: "0" }, { ...g, maxContinuations: null }]) {
    assert.equal(goalFromEntry(bad), undefined, JSON.stringify(bad));
  }
});

test("prompts carry the objective, check, budget, and check output", () => {
  const g = { ...newGoal("fix flaky test", "npm test", 5), continuations: 2, lastCheck: { exit: 1, tail: "1 failing", timedOut: false, at: 0 } };
  assert.match(startMessage(g, "set"), /fix flaky test[\s\S]*npm test[\s\S]*2\/5[\s\S]*Never weaken/);
  assert.match(GOAL_GUIDELINES.join("\n"), /Never weaken[\s\S]*goal_park/);
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

test("runCheck returns even when a daemon escapes the process group holding its output", async () => {
  // perl's setsid() leaves the check's process group but keeps the stdout pipe open.
  const started = Date.now();
  const r = await runCheck(tmpdir(), "perl -MPOSIX -e 'setsid(); sleep 6' & echo out; exit 3", 5000);
  assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
  assert.deepEqual([r.exit, r.timedOut, r.tail.trim()], [3, false, "out"]);
  const hung = await runCheck(tmpdir(), "perl -MPOSIX -e 'setsid(); sleep 6' & sleep 20", 300);
  assert.equal(hung.timedOut, true);
});

test("runCheck kills background jobs the check leaves in its process group", async () => {
  const r = await runCheck(tmpdir(), "sleep 30 & echo $!; exit 0", 5000);
  const pid = Number(r.tail.trim());
  assert.ok(pid > 0);
  // The killed job lingers as a zombie until init reaps it, which can be slow on a loaded machine.
  await until(() => gone(pid));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("runCheck keeps the real exit code when the timeout lands while output drains", async (t) => {
  // Mocked timers put the deadline inside the drain window no matter how slow a loaded machine
  // spawns the shell; real time would race the spawn against a few hundred milliseconds.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pidFile = join(mkdtempSync(join(tmpdir(), "goal-check-")), "pid");
  const pending = runCheck(tmpdir(), `echo $$ > ${pidFile}; sleep 5 & exit 0`, 300);
  // The child is reaped, and its exit seen, only once its pid is gone.
  await until(() => existsSync(pidFile) && /\n$/.test(readFileSync(pidFile, "utf8")));
  await until(() => gone(Number(readFileSync(pidFile, "utf8"))));
  t.mock.timers.tick(300);
  t.mock.timers.tick(500);
  const r = await pending;
  assert.deepEqual([r.exit, r.timedOut], [0, false]);
});

// Polls on setImmediate, which mocked setTimeout leaves alone; gives up after 10 s of real time.
async function until(ready: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, "timed out waiting");
    await new Promise((done) => setImmediate(done));
  }
}

function gone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw error;
  }
}

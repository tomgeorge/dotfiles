import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArgs, CHILD_EXTENSIONS, GIT_EXTENSION, runSubagent, type Job, type Progress } from "./runner.ts";

const job: Job = {
  task: "--evil @file $(echo nope)", provider: "test", model: "exact/model",
  cwd: process.cwd(), tools: ["read", "grep"],
};
const message = (text = "Done", stopReason = "stop", extra = {}) => ({
  type: "message_end", message: {
    role: "assistant", provider: job.provider, model: job.model,
    content: [{ type: "text", text }], stopReason, ...extra,
  },
});
const emit = (value: unknown) => `console.log(${JSON.stringify(JSON.stringify(value))});`;
const run = (script: string, options = {}) => runSubagent(job, {
  command: process.execPath, prefixArgs: ["-e", script, "--"], ...options,
});

test("explicit arguments, isolated reader, literal task", () => {
  const args = buildArgs(job);
  for (const flag of ["--no-session", "--no-extensions", "--no-skills", "--no-approve"]) {
    assert.ok(args.includes(flag));
  }
  assert.equal(args.at(-1), `Task: ${job.task}`);
  assert.equal(args[args.indexOf("--model") + 1], job.model);
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
});

test("loads only the listed child extensions", () => {
  const args = buildArgs(job);
  for (const source of CHILD_EXTENSIONS) {
    assert.equal(args[args.indexOf(source) - 1], "-e");
  }
  const custom = buildArgs(job, ["./a.ts", "npm:b"]);
  assert.deepEqual(custom.filter((arg, i) => custom[i - 1] === "-e"), ["./a.ts", "npm:b"]);
  assert.ok(!buildArgs(job, []).includes("-e"));
});

test("loads the git extension only when git is requested", () => {
  assert.ok(!buildArgs(job).includes(GIT_EXTENSION));
  const args = buildArgs({ ...job, tools: ["read", "git"] });
  assert.equal(args[args.indexOf(GIT_EXTENSION) - 1], "-e");
  assert.equal(args[args.indexOf("--tools") + 1], "read,git");
  assert.match(GIT_EXTENSION, /git-read\.ts$/);
});

test("reject invalid jobs before spawning", async () => {
  for (const change of [{ tools: ["bash"] }, { tools: [] }, { cwd: "relative" }, { task: " " }]) {
    await assert.rejects(runSubagent({ ...job, ...change }));
  }
});

test("returns final assistant answer, not commentary or tool output", async () => {
  const result = await run(emit(message("Working", "toolUse")) +
    emit({ type: "message_end", message: { role: "toolResult", content: "ignore" } }) +
    emit(message("Final")));
  assert.deepEqual(result, { status: "ok", text: "Final", error: null });
});

test("decodes split UTF-8, final line without newline, and Unicode separators", async () => {
  const data = Buffer.from(JSON.stringify(message("Hello 🌍\u2028again")));
  const split = data.indexOf(Buffer.from("🌍")) + 1;
  const result = await run(`process.stdout.write(Buffer.from(${JSON.stringify([...data.subarray(0, split)])}));
    setTimeout(() => process.stdout.write(Buffer.from(${JSON.stringify([...data.subarray(split)])})), 20);`);
  assert.equal(result.text, "Hello 🌍\u2028again");
  assert.equal(result.status, "ok");
});

test("model failure is not success even with exit zero", async () => {
  const result = await run(emit(message("", "error", { errorMessage: "No credit" })));
  assert.equal(result.status, "error");
  assert.equal(result.error, "No credit");
});

test("nonzero exit preserves diagnostic", async () => {
  const result = await run('console.error("bad auth"); process.exitCode = 2;');
  assert.equal(result.status, "error");
  assert.equal(result.error, "bad auth");
});

test("missing final answer, malformed events, and wrong models fail", async () => {
  for (const script of ["", 'console.log("not json")', emit(message("Wrong", "stop", { model: "other" })), emit(message("partial", "length"))]) {
    assert.equal((await run(script)).status, "error");
  }
});

test("malformed message content is a bad event; non-object events are ignored", async () => {
  for (const content of ["text", [null], { type: "text" }]) {
    const result = await run(emit(message("x", "stop", { content })));
    assert.deepEqual([result.status, result.error], ["error", "Invalid JSON event from subagent"]);
  }
  const result = await run(emit(42) + emit("hello") + emit(null) + emit([1]) + emit(message("Final")));
  assert.deepEqual(result, { status: "ok", text: "Final", error: null });
});

test("tool args that can't be shown are a bad event, not a crash", async () => {
  const result = await run(emit({ type: "tool_execution_start", toolName: "git", args: { args: [{ toString: null }] } }) + emit(message("Final")));
  assert.deepEqual([result.status, result.error], ["error", "Invalid JSON event from subagent"]);
});

test("spawn failures are returned", async () => {
  const result = await runSubagent(job, { command: "/nonexistent-pi-subagent-test" });
  assert.equal(result.status, "error");
  assert.match(result.error!, /ENOENT/);
});

test("pre-cancelled jobs do not spawn", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runSubagent(job, { signal: controller.signal, command: "/nonexistent" });
  assert.equal(result.status, "cancelled");
});

test("cancellation terminates the child", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    const result = await run("setInterval(() => {}, 1000)", { signal: controller.signal });
    assert.equal(result.status, "cancelled");
  } finally { clearTimeout(timer); }
});

test("timeout escalates if child ignores SIGTERM", async () => {
  const result = await run('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);', { timeoutMs: 300 });
  assert.equal(result.status, "error");
  assert.match(result.error!, /timed out/);
});

test("reports child tool calls as progress", async () => {
  const seen: unknown[] = [];
  const result = await run(
    emit({ type: "tool_execution_start", toolCallId: "1", toolName: "grep", args: { pattern: "foo" } }) +
    emit({ type: "tool_execution_start", toolCallId: "2", toolName: "read", args: { path: "a.ts" } }) +
    emit({ type: "tool_execution_start", toolCallId: "3", toolName: "git", args: { args: ["log", "-1"] } }) +
    emit(message("Final")),
    { onProgress: (p: Progress) => seen.push({ toolCalls: p.toolCalls, activity: p.activity }) },
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(seen.slice(0, 3), [
    { toolCalls: 1, activity: "grep foo" },
    { toolCalls: 2, activity: "read a.ts" },
    { toolCalls: 3, activity: "git log -1" },
  ]);
});

test("reports phase and usage summed across turns", async () => {
  const seen: Progress[] = [];
  const usage = (input: number, output: number, total: number) =>
    ({ input, output, cacheRead: 10, cacheWrite: 0, cost: { total } });
  const result = await run(
    emit({ type: "message_update", usage: usage(100, 5, 0.01), assistantMessageEvent: { type: "thinking_start" } }) +
    emit(message("Working", "toolUse", { usage: usage(100, 20, 0.02) })) +
    emit({ type: "message_update", usage: usage(200, 3, 0.005), assistantMessageEvent: { type: "text_start" } }) +
    emit(message("Final", "stop", { usage: usage(200, 30, 0.04) })),
    { onProgress: (p: Progress) => seen.push(p) },
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(seen.map((p) => p.phase), ["thinking", "thinking", "writing", "writing"]);
  // In-flight usage counts on top of finished turns, then is replaced by the final.
  assert.deepEqual(seen[2].usage, { input: 110 + 210, output: 23, cost: 0.025 });
  assert.deepEqual(seen.at(-1)!.usage, { input: 320, output: 50, cost: 0.06 });
});

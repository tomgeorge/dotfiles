import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArgs, CHILD_EXTENSIONS, runSubagent, type Job } from "./runner.ts";

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

test("concurrent jobs keep separate output and cancel independently", async () => {
  const slow = (text: string) => `setTimeout(() => { ${emit(message(text))} }, 200);`;
  const controller = new AbortController();
  const [a, b, c] = await Promise.all([
    run(slow("from A")),
    run(slow("from B")),
    run("setInterval(() => {}, 1000)", { signal: controller.signal }),
    new Promise((resolve) => setTimeout(resolve, 50)).then(() => controller.abort()),
  ]);
  assert.deepEqual(a, { status: "ok", text: "from A", error: null });
  assert.deepEqual(b, { status: "ok", text: "from B", error: null });
  assert.equal(c.status, "cancelled");
});

test("timeout escalates if child ignores SIGTERM", async () => {
  const result = await run('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);', { timeoutMs: 300 });
  assert.equal(result.status, "error");
  assert.match(result.error!, /timed out/);
});

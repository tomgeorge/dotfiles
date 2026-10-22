import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkerArgs, runWorker, type WorkerJob } from "./worker.ts";

const job: WorkerJob = {
  provider: "test", model: "exact/model", cwd: process.cwd(), tools: ["read", "edit", "bash"],
  prompt: "--evil @file", extensions: ["npm:auth", "/abs/guard.ts"], env: { PI_CREW_ROOT: "/wt" },
};
const end = (text: string, stopReason = "stop") => ({
  type: "message_end",
  message: { role: "assistant", provider: job.provider, model: job.model, content: [{ type: "text", text }], stopReason, usage: { input: 10, output: 5, cost: { total: 0.25 } } },
});
const emit = (value: unknown) => `console.log(${JSON.stringify(JSON.stringify(value))});`;
const run = (script: string, timeoutMs = 5000, signal?: AbortSignal) =>
  runWorker(job, { command: process.execPath, prefixArgs: ["-e", script, "--"], timeoutMs, signal });

test("args: isolated child, explicit extensions and tools, literal prompt", () => {
  const args = buildWorkerArgs(job);
  assert.deepEqual(args.slice(0, 5), ["-p", "--mode", "json", "--no-session", "--no-extensions"]);
  assert.deepEqual(args.filter((_, i) => args[i - 1] === "-e"), ["npm:auth", "/abs/guard.ts"]);
  assert.equal(args[args.indexOf("--tools") + 1], "read,edit,bash");
  assert.equal(args.at(-1), "Task: --evil @file");
});

test("ok result carries final text, usage, and passes env to the child", async () => {
  const r = await run(`${emit({ type: "tool_execution_start", toolName: "bash", args: { command: "npm test" } })}
    console.log(JSON.stringify(${JSON.stringify(end("x"))}).replace('"x"', JSON.stringify(process.env.PI_CREW_ROOT)));`);
  assert.equal(r.status, "ok");
  assert.equal(r.text, "/wt");
  assert.equal(r.progress.toolCalls, 1);
  assert.equal(r.progress.activity, "bash npm test");
  assert.equal(r.progress.usage.cost, 0.25);
});

test("thinking-only stream events count as liveness", async () => {
  const before = Date.now();
  const r = await run(`${emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } })}
    setTimeout(() => { ${emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "more" } })} ${emit(end("done"))} }, 300);`);
  assert.equal(r.status, "ok");
  assert.ok(r.progress.lastEventAt >= before + 250, "last event time advanced during thinking");
});

test("timeout kills the process group and keeps partial output", async () => {
  const r = await run(`${emit(end("step one done", "toolUse"))}
    ${emit({ type: "message_update", assistantMessageEvent: { type: "text_start" } })}
    ${emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "now editing b.ts" } })}
    require("node:child_process").spawn("sleep", ["30"], { stdio: "ignore" });
    setInterval(() => {}, 1000);`, 400);
  assert.equal(r.status, "timeout");
  assert.match(r.text, /step one done/);
  assert.match(r.text, /now editing b\.ts/);
});

test("cancel, wrong model, and incomplete runs are reported, not thrown", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  assert.equal((await run("setInterval(() => {}, 1000);", 5000, controller.signal)).status, "cancelled");

  const wrong = await run(emit({ ...end("x"), message: { ...end("x").message, model: "other" } }));
  assert.equal(wrong.status, "error");
  assert.match(wrong.error!, /requested test\/exact\/model/);

  const noise = await run(`console.log("not json"); ${emit(end("ok"))}`);
  assert.equal(noise.status, "ok", "non-JSON noise doesn't kill the worker");

  const truncated = await run(emit(end("half", "length")));
  assert.equal(truncated.status, "error");
  assert.equal(truncated.text, "half");
});

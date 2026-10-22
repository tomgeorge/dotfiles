import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, SessionCache, SessionTail, Transcript, type SessionFs } from "./transcript.ts";

const update = (assistantMessageEvent: Record<string, unknown>) => ({ type: "message_update", assistantMessageEvent });
const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall", id, name, arguments: args });
const result = (text: string) => ({ content: [{ type: "text", text }] });

/** One worker turn as `pi --mode json` streams it: prompt, thinking, text, two tool calls. */
const STREAM = [
  { type: "message_start", message: { role: "user", content: "Task: paint it" } },
  { type: "message_start", message: { role: "assistant", content: [] } },
  update({ type: "thinking_start", contentIndex: 0 }),
  update({ type: "thinking_delta", contentIndex: 0, delta: "Let me " }),
  update({ type: "thinking_delta", contentIndex: 0, delta: "look" }),
  update({ type: "text_start", contentIndex: 1 }),
  update({ type: "text_delta", contentIndex: 1, delta: "Readi" }),
  update({ type: "toolcall_start", contentIndex: 2, id: "a", toolName: "read" }),
  update({ type: "toolcall_end", contentIndex: 2, toolCall: toolCall("a", "read", { path: "theme.ts" }) }),
  update({ type: "toolcall_start", contentIndex: 3, id: "b", toolName: "bash" }),
  { type: "message_end", message: { role: "assistant", content: [
    { type: "thinking", thinking: "Let me look", thinkingSignature: "secret" },
    { type: "text", text: "Reading the theme." },
    toolCall("a", "read", { path: "theme.ts" }),
    toolCall("b", "bash", { command: "npm test" }),
  ] } },
  // Tools may run in parallel and finish out of order.
  { type: "tool_execution_start", toolCallId: "a", toolName: "read", args: { path: "theme.ts" } },
  { type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: { command: "npm test" } },
  { type: "tool_execution_update", toolCallId: "b", toolName: "bash", partialResult: result("running…") },
  { type: "tool_execution_end", toolCallId: "b", toolName: "bash", result: result("1 failing"), isError: true },
  { type: "tool_execution_end", toolCallId: "a", toolName: "read", result: result("export const x = 1;"), isError: false },
];

/** The same turn as the session file records it. */
const SESSION = [
  { type: "session", version: 3, id: "s", cwd: "/wt" },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Task: paint it" }] } },
  { type: "message", message: { role: "assistant", content: STREAM[10].message!.content } },
  { type: "message", message: { role: "toolResult", toolCallId: "b", toolName: "bash", ...result("1 failing"), isError: true } },
  { type: "message", message: { role: "toolResult", toolCallId: "a", toolName: "read", ...result("export const x = 1;"), isError: false } },
];

const EXPECTED = [
  { kind: "user", text: "Task: paint it" },
  { kind: "thinking", text: "Let me look" },
  { kind: "text", text: "Reading the theme." },
  { kind: "tool", id: "a", name: "read", args: "theme.ts", result: "export const x = 1;", state: "ok" },
  { kind: "tool", id: "b", name: "bash", args: "npm test", result: "1 failing", state: "error" },
];

test("the stream builds one entry per block; the final message replaces deltas without duplicating", () => {
  const t = new Transcript();
  for (const event of STREAM.slice(0, 10)) t.applyEvent(event);
  // Mid-stream: deltas are visible before the message finishes.
  assert.equal(t.entries[1].kind === "thinking" && t.entries[1].text, "Let me look");
  assert.equal(t.entries[2].kind === "text" && t.entries[2].text, "Readi");
  for (const event of STREAM.slice(10, 14)) t.applyEvent(event);
  const bash = t.entries[4];
  assert.ok(bash.kind === "tool" && bash.state === "running" && bash.result === "running…", "partial tool output streams");
  for (const event of STREAM.slice(14)) t.applyEvent(event);
  assert.deepEqual(t.entries, EXPECTED);
  assert.ok(!JSON.stringify(t.entries).includes("secret"), "thinking signatures are never kept");
});

test("a session file gives the same transcript as the stream", () => {
  const t = new Transcript();
  for (const entry of SESSION) t.applySessionEntry(entry);
  assert.deepEqual(t.entries, EXPECTED);
});

test("redacted thinking shows a placeholder, and a model error becomes a note", () => {
  const t = new Transcript();
  t.applyEvent({ type: "message_start", message: { role: "assistant" } });
  t.applyEvent({ type: "message_end", message: { role: "assistant", errorMessage: "overloaded", content: [{ type: "thinking", thinking: "", redacted: true, thinkingSignature: "x" }] } });
  assert.deepEqual(t.entries, [{ kind: "thinking", text: "(redacted thinking)" }, { kind: "note", text: "error: overloaded" }]);
});

test("old entries are evicted to stay within the entry and size limits", () => {
  const t = new Transcript();
  for (let i = 0; i < LIMITS.entries + 5; i++) {
    t.applyEvent({ type: "tool_execution_start", toolCallId: `t${i}`, toolName: "bash", args: { command: `echo ${i}` } });
  }
  assert.equal(t.entries.length, LIMITS.entries);
  assert.equal(t.dropped, 5);
  assert.equal(t.entries[0].kind === "tool" && t.entries[0].args, "echo 5");
  // An evicted call's late result doesn't reach the call it no longer shows.
  t.applyEvent({ type: "tool_execution_update", toolCallId: "t0", toolName: "bash", partialResult: result("late") });
  assert.ok(!t.entries.some((e) => e.kind === "tool" && e.result === "late"));

  const big = new Transcript();
  const chunk = "x".repeat(LIMITS.text);
  for (let i = 0; i < 100; i++) big.applySessionEntry({ type: "message", message: { role: "assistant", content: [{ type: "text", text: chunk }] } });
  const chars = big.entries.reduce((n, e) => n + (e.kind === "tool" ? 0 : e.text.length), 0);
  assert.ok(chars <= LIMITS.chars, `kept ${chars} chars`);
  assert.ok(big.dropped > 0);
});

test("one long block keeps its newest text", () => {
  const t = new Transcript();
  t.applyEvent(update({ type: "text_start", contentIndex: 0 }));
  for (let i = 0; i < 50; i++) t.applyEvent(update({ type: "text_delta", contentIndex: 0, delta: `${"y".repeat(1000)}${i}|` }));
  const text = t.entries[0].kind === "text" ? t.entries[0].text : "";
  assert.equal(text.length, LIMITS.text);
  assert.ok(text.startsWith("…") && text.endsWith("49|"));
});

/** An in-memory file that hands out at most `step` bytes per read, to split records and characters. */
function fakeFs(step: number) {
  const file = { data: Buffer.alloc(0), ino: 1, exists: true };
  const fs: SessionFs = {
    stat: async () => (file.exists ? { size: file.data.length, ino: file.ino } : undefined),
    read: async (_path, offset, length) => file.data.subarray(offset, offset + Math.min(length, step)),
  };
  const append = (text: string) => { file.data = Buffer.concat([file.data, Buffer.from(text, "utf8")]); };
  return { file, fs, append };
}

test("a session tail reads only what was appended, across partial records and split characters", async () => {
  const { file, fs, append } = fakeFs(3);
  const tail = new SessionTail("/s.jsonl", fs);
  file.exists = false;
  assert.equal(await tail.poll(), false);
  assert.equal(tail.exists, false);

  file.exists = true;
  const lines = SESSION.map((e) => JSON.stringify(e));
  // A multi-byte character, and the last record half written.
  const prompt = JSON.stringify({ type: "message", message: { role: "user", content: "Task: paint it — ünïcode ✓" } });
  append(`${lines[0]}\n${prompt}\n${lines[2].slice(0, 20)}`);
  await tail.poll();
  assert.deepEqual(tail.transcript.entries, [{ kind: "user", text: "Task: paint it — ünïcode ✓" }]);

  append(`${lines[2].slice(20)}\n${lines[3]}\n${lines[4]}\nnot json\n`);
  assert.equal(await tail.poll(), true);
  assert.deepEqual(tail.transcript.entries.slice(1), EXPECTED.slice(1));
  assert.equal(await tail.poll(), false, "nothing new");

  // Replaced (new inode) or truncated: start over.
  file.ino = 2;
  file.data = Buffer.from(`${lines[1]}\n`);
  await tail.poll();
  assert.deepEqual(tail.transcript.entries, [EXPECTED[0]]);
});

test("the session cache loads on demand, rechecks at most every recheckMs, and reports a missing file", async () => {
  const { file, fs, append } = fakeFs(1 << 20);
  const cache = new SessionCache(fs, 1000);
  let changes = 0;
  const onChange = () => { changes++; };
  file.exists = false;
  assert.deepEqual(cache.get("/s.jsonl", onChange, 0), { state: "loading" });
  await new Promise((r) => setImmediate(r));
  assert.equal(changes, 1);
  assert.match((cache.get("/s.jsonl", onChange, 1) as any).message, /No session file yet/);

  file.exists = true;
  append(`${JSON.stringify(SESSION[1])}\n`);
  assert.equal(cache.get("/s.jsonl", onChange, 500).state, "unavailable", "not rechecked within recheckMs");
  cache.get("/s.jsonl", onChange, 1000);
  await new Promise((r) => setImmediate(r));
  const view = cache.get("/s.jsonl", onChange, 1001);
  assert.ok(view.state === "ready" && view.source === "file");
  assert.deepEqual(view.transcript.entries, [EXPECTED[0]]);
});

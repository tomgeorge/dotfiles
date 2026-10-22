import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { analyze, clusterErrors, commandShape, report } from "./collect.ts";

const j = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n");

test("pi transcript: errors, repeats, corrections, aborts, with line refs", () => {
  const call = (id: string, command: string) => ({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] } });
  const result = (id: string, isError: boolean, text: string) => ({ type: "message", message: { role: "toolResult", toolCallId: id, isError, content: [{ type: "text", text }] } });
  const text = j(
    { type: "session", cwd: "/repo" },
    { type: "message", message: { role: "user", content: "add a flag" } },
    call("a", "python -c 'print(1)'"), result("a", true, "python: command not found"),
    call("b", "ls"), result("b", false, "x"), call("c", "ls"), result("c", false, "x"), call("d", "ls"), result("d", false, "x"),
    { type: "message", message: { role: "user", content: "no, use uv run instead" } },
    { type: "message", message: { role: "user", content: "<system-reminder>ignored</system-reminder>" } },
    { type: "message", message: { role: "assistant", content: [], stopReason: "aborted" } },
    "not json",
  );
  const { summary, signals } = analyze("/s/p.jsonl", text, "pi");
  assert.deepEqual([summary.cwd, summary.userMessages, summary.toolCalls, summary.errors], ["/repo", 2, 4, 1]);
  const error = signals.find((s) => s.kind === "error")!;
  assert.equal(error.ref.line, 4);
  assert.match(error.detail, /bash python -c .* → python: command not found/);
  assert.match(signals.find((s) => s.kind === "repeat")!.detail, /3× identical call: bash ls/);
  assert.equal(signals.find((s) => s.kind === "correction")!.detail, "no, use uv run instead");
  assert.equal(signals.filter((s) => s.kind === "abort").length, 1);
});

test("claude transcript: tool_use / tool_result and interrupts", () => {
  const text = j(
    { type: "user", cwd: "/w", message: { role: "user", content: "fix the build" } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "make bild" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "make: *** No rule to make target 'bild'" }] } },
    { type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } },
    { type: "user", message: { content: "actually, run the tests first" } },
  );
  const { summary, signals } = analyze("/s/c.jsonl", text, "claude");
  assert.deepEqual([summary.cwd, summary.toolCalls, summary.errors], ["/w", 1, 1]);
  assert.match(signals.find((s) => s.kind === "error")!.detail, /Bash make bild → make: \*\*\* No rule/);
  assert.ok(signals.some((s) => s.kind === "abort"));
  assert.ok(signals.some((s) => s.kind === "correction" && /run the tests first/.test(s.detail)));
});

test("clusters recurring errors across sessions and renders a capped report", () => {
  const err = (file: string, cmd: string) => ({ kind: "error" as const, source: "pi" as const, cwd: "/r", ref: { file, line: 1 }, tool: "bash", detail: `bash ${cmd} → boom` });
  const signals = [err("/a", "npm run lint --fix"), err("/b", "npm run lint --quiet"), err("/a", "cargo build")];
  const clusters = clusterErrors(signals);
  assert.deepEqual(clusters.map((c) => [c.key, c.count, c.sessions]), [["bash: npm run", 2, 2]]);
  const out = report([{ source: "pi", file: "/a", cwd: "/r", userMessages: 3, toolCalls: 9, errors: 3 }], signals, 7, 1);
  assert.match(out, /1 sessions \(1 Pi, 0 Claude Code\) · 3 user messages · 9 tool calls · 3 failed/);
  assert.match(out, /2× in 2 session\(s\)/);
  assert.match(out, /\(\+2 more\)/);
  assert.match(out, /## Corrections and pushback from the user\n\(none\)/);
});

test("commandShape ignores cd hops and env assignments", () => {
  assert.equal(commandShape("bash cd ~/git/x && cd sub; FOO=1 BAR= npm run lint", "bash"), "npm run");
  assert.equal(commandShape("codemode", "codemode"), "codemode");
  assert.equal(commandShape("read /etc/hosts", "read"), "/etc/hosts");
});

test("runs as a script through a symlink, as /retro invokes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "retro-"));
  const link = join(dir, "retro");
  symlinkSync(dirname(fileURLToPath(import.meta.url)), link);
  const sessions = join(dir, "pi", "proj");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "s.jsonl"), JSON.stringify({ type: "session", cwd: "/x" }));
  const out = execFileSync(process.execPath, [join(link, "collect.ts"), "--days", "1", "--pi", join(dir, "pi"), "--claude", join(dir, "none")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.match(out, /# Agent friction signals, last 1 days\n\n1 sessions \(1 Pi, 0 Claude Code\)/);
});

test("claude: a rejected tool call is the user steering, not a tool failure", () => {
  const rejected = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";
  const text = j(
    { type: "assistant", cwd: "/w", message: { content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "dev.nix" } }, { type: "tool_use", id: "t2", name: "Bash", input: { command: "git push" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: `${rejected} To tell you how to proceed, the user said:\nactually this isn't a good fit for dev.nix` }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: rejected }] } },
    // Claude Code follows a bare rejection with this marker, so it alone stands for the interrupt.
    { type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } },
  );
  const { summary, signals } = analyze("/s/c.jsonl", text, "claude");
  assert.deepEqual([summary.errors, summary.userMessages], [0, 2]);
  assert.ok(signals.some((s) => s.kind === "correction" && s.detail === "actually this isn't a good fit for dev.nix"));
  assert.equal(signals.filter((s) => s.kind === "abort").length, 1);
  assert.ok(!signals.some((s) => s.kind === "error"));
});

test("claude: subagent (sidechain) prompts aren't the user", () => {
  const text = j({ type: "user", isSidechain: true, cwd: "/w", message: { role: "user", content: "Don't modify files; list the failing tests." } });
  const { summary, signals } = analyze("/s/agent-1.jsonl", text, "claude");
  assert.deepEqual([summary.userMessages, signals.length], [0, 0]);
});

test("unexpected content shapes are skipped, not fatal", () => {
  const text = j(
    { type: "message", message: { role: "assistant", content: {} } },
    { type: "message", message: { role: "user", content: 7 } },
  );
  assert.doesNotThrow(() => analyze("/s/p.jsonl", text, "pi"));
  assert.doesNotThrow(() => analyze("/s/c.jsonl", j({ type: "assistant", message: { content: [null] } }), "claude"));
});

test("only events inside the window count, even in a long-running session", () => {
  const old = "2026-01-05T10:00:00.000Z";
  const now = "2026-10-20T10:00:00.000Z";
  const text = j(
    { type: "session", cwd: "/repo", timestamp: old },
    { type: "message", timestamp: old, message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "bash", arguments: { command: "x" } }] } },
    { type: "message", timestamp: old, message: { role: "toolResult", toolCallId: "a", isError: true, content: "boom" } },
    { type: "message", timestamp: now, message: { role: "user", content: "no, stop" } },
  );
  const { summary, signals } = analyze("/s/p.jsonl", text, "pi", Date.parse("2026-10-13T00:00:00Z"));
  assert.deepEqual([summary.cwd, summary.toolCalls, summary.errors, summary.userMessages], ["/repo", 0, 0, 1]);
  assert.deepEqual(signals.map((s) => s.kind), ["correction"]);
});

test("a dangling .jsonl symlink doesn't stop the run", () => {
  const dir = mkdtempSync(join(tmpdir(), "retro-"));
  mkdirSync(join(dir, "pi"), { recursive: true });
  symlinkSync(join(dir, "nonexistent"), join(dir, "pi", "dead.jsonl"));
  const out = execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "collect.ts"), "--pi", join(dir, "pi"), "--claude", join(dir, "none")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.match(out, /0 sessions/);
});

test("a result inside the window still names a call made just before it", () => {
  const text = j(
    { type: "message", timestamp: "2026-10-12T23:59:59.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "bash", arguments: { command: "make" } }] } },
    { type: "message", timestamp: "2026-10-13T00:00:01.000Z", message: { role: "toolResult", toolCallId: "a", isError: true, content: "boom" } },
  );
  const { summary, signals } = analyze("/s/p.jsonl", text, "pi", Date.parse("2026-10-13T00:00:00Z"));
  assert.deepEqual([summary.toolCalls, summary.errors], [0, 1]);
  assert.equal(signals[0].tool, "bash");
  assert.match(signals[0].detail, /^bash make → boom/);
});

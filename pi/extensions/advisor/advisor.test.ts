import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readConfig, serializeTranscript, trimTranscript, writeConfig } from "./advisor.ts";

test("config round-trips, 'off' is an empty object, and junk is rejected", () => {
  const path = join(mkdtempSync(join(tmpdir(), "advisor-")), "nested", "advisor.json");
  assert.equal(readConfig(path), undefined);
  writeConfig(path, { provider: "openai-codex", model: "gpt-6.1-sol" });
  assert.deepEqual(readConfig(path), { provider: "openai-codex", model: "gpt-6.1-sol" });
  writeConfig(path, undefined);
  assert.equal(readConfig(path), undefined);
  writeFileSync(path, '{"provider": "p"}');
  assert.throws(() => readConfig(path), /must contain/);
});

test("trimTranscript keeps the head and the recent tail", () => {
  assert.equal(trimTranscript("short", 100), "short");
  const text = `TASK:${"a".repeat(500)}${"b".repeat(500)}:RECENT`;
  const out = trimTranscript(text, 200, 20);
  assert.ok(out.startsWith("TASK:"));
  assert.ok(out.endsWith(":RECENT"));
  assert.match(out, /\[\.\.\. 812 characters of the middle of the conversation omitted \.\.\.\]/);
});


test("serializeTranscript keeps whole tool results, calls, thinking, and text", () => {
  const out = serializeTranscript([
    { role: "user", content: [{ type: "text", text: "fix the build" }] },
    { role: "assistant", content: [
      { type: "thinking", thinking: "check make" },
      { type: "text", text: "Running make." },
      { type: "toolCall", id: "1", name: "bash", arguments: { command: "make" } },
    ] },
    { role: "toolResult", toolCallId: "1", toolName: "bash", isError: true, content: [{ type: "text", text: `${"a".repeat(5000)}CRITICAL ERROR` }] },
    { role: "user", content: "plain string content" },
  ] as never);
  assert.match(out, /\[User\]: fix the build/);
  assert.match(out, /\[Assistant thinking\]: check make/);
  assert.match(out, /\[Assistant\]: Running make\./);
  assert.match(out, /\[Assistant tool calls\]: bash\(command="make"\)/);
  assert.match(out, /\[Tool result \(error\)\]: a{5000}CRITICAL ERROR/);
  assert.match(out, /\[User\]: plain string content/);
});

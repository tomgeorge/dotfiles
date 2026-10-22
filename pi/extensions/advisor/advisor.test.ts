import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  advisorPrompt, modelRef, parseModelRef, readConfig, serializeTranscript, textOf, trimTranscript, writeConfig,
} from "./advisor.ts";

test("config round-trips, 'off' is an empty object, and junk is rejected", () => {
  const path = join(mkdtempSync(join(tmpdir(), "advisor-")), "nested", "advisor.json");
  assert.equal(readConfig(path), undefined);
  writeConfig(path, { provider: "openai-codex", model: "gpt-6.1-sol" });
  assert.deepEqual(readConfig(path), { provider: "openai-codex", model: "gpt-6.1-sol" });
  writeConfig(path, undefined);
  assert.equal(readConfig(path), undefined);
  writeFileSync(path, '{"provider": "p"}');
  assert.throws(() => readConfig(path), /must contain/);
  for (const json of ["null", "0", '"off"', "true", "[]", '["p", "m"]']) {
    writeFileSync(path, json);
    assert.throws(() => readConfig(path), /must contain/, json);
  }
});

test("trimTranscript keeps the head and the recent tail", () => {
  assert.equal(trimTranscript("short", 100), "short");
  const text = `TASK:${"a".repeat(500)}${"b".repeat(500)}:RECENT`;
  const out = trimTranscript(text, 200, 20);
  assert.ok(out.startsWith("TASK:"));
  assert.ok(out.endsWith(":RECENT"));
  assert.match(out, /\[\.\.\. 812 characters of the middle of the conversation omitted \.\.\.\]/);
});

test("modelRef and parseModelRef use provider/model, splitting at the first slash", () => {
  assert.equal(modelRef(undefined), "off");
  assert.equal(modelRef({ provider: "openai-codex", model: "gpt-6.1-sol" }), "openai-codex/gpt-6.1-sol");
  assert.deepEqual(parseModelRef("openrouter/anthropic/claude"), { provider: "openrouter", model: "anthropic/claude" });
});

test("advisorPrompt puts the transcript before the question", () => {
  assert.equal(advisorPrompt("T", "Q?"), "## Conversation so far\n\nT\n\n## The agent's question\n\nQ?");
});

test("textOf joins text parts and skips the rest", () => {
  assert.equal(textOf("plain"), "plain");
  assert.equal(textOf([
    { type: "thinking", thinking: "hmm" },
    { type: "text", text: "a" },
    { type: "toolCall", id: "1", name: "bash", arguments: {} },
    { type: "text", text: "b" },
  ] as never), "a\nb");
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

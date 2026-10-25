import assert from "node:assert/strict";
import { test } from "node:test";
import { argRows, boxTable, describeTool, wrap } from "./format.ts";

test("heading names server and tool, plus the description's first line", () => {
  assert.deepEqual(describeTool("mcp__slack__send_message", "Send a message.\nMore detail."), {
    title: "Allow slack › send_message?",
    summary: "Send a message.",
  });
  assert.deepEqual(describeTool("odd"), { title: "Allow odd?", summary: undefined });
});

test("rows flatten nested input and join scalar lists", () => {
  assert.deepEqual(argRows({ postingIds: [1, 2], opts: { draft: false, n: null }, blocks: [{ type: "a" }], empty: "", list: [] }), [
    ["postingIds", "1, 2"],
    ["opts.draft", "false"],
    ["opts.n", "null"],
    ["blocks[0].type", "a"],
    ["empty", '""'],
    ["list", "[]"],
  ]);
  assert.deepEqual(argRows({}), []);
  assert.deepEqual(argRows("raw"), [["(value)", "raw"]]);
});

test("control characters are shown escaped, not interpreted", () => {
  assert.deepEqual(argRows({ text: "ok\x1b[2Khidden\rx\ty" }), [["text", "ok\\u001b[2Khidden\\u000dx  y"]]);
});

test("the table fits the width, wrapping values inside their cell", () => {
  const lines = boxTable([["to", "trail"], ["text", "the quick brown fox jumps"]], 24);
  assert.deepEqual(lines, [
    "┌──────┬───────────────┐",
    "│ to   │ trail         │",
    "├──────┼───────────────┤",
    "│ text │ the quick     │",
    "│      │ brown fox     │",
    "│      │ jumps         │",
    "└──────┴───────────────┘",
  ]);
  assert.ok(lines.every((l) => [...l].length <= 24));
  assert.deepEqual(boxTable([], 40), ["(no arguments)"]);
});

test("wrap keeps newlines and breaks words longer than the width", () => {
  assert.deepEqual(wrap("ab cd\nabcdefgh", 4), ["ab", "cd", "abcd", "efgh"]);
});

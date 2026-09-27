import assert from "node:assert/strict";
import { test } from "node:test";
import { changeLine, deleteChars, deleteLines, deleteToEnd, openLine, type Edit } from "./operators.ts";
import { parse, show } from "./testutil.ts";

type EditFn = (lines: string[], pos: { line: number; col: number }) => Edit | null;

function check(name: string, fn: EditFn, cases: [string, string | null][]) {
  test(name, () => {
    for (const [from, to] of cases) {
      const { lines, pos } = parse(from);
      const edit = fn(lines, pos);
      assert.equal(edit && show(edit.lines, edit.cursor), to, `from ${JSON.stringify(from)}`);
    }
  });
}

check("x", (l, p) => deleteChars(l, p), [
  ["a|bc", "a|c"],
  ["ab|c", "a|b"],
  ["|a", "|"],
  ["|", null],
  ["|👍🏽x", "|x"],
]);

check("dd", (l, p) => deleteLines(l, p), [
  ["|one\ntwo\nthree", "|two\nthree"],
  ["one\nt|wo\n  three", "one\n  |three"],
  ["one\ntwo\nth|ree", "one\n|two"],
  ["on|ly", "|"],
]);

check("2dd", (l, p) => deleteLines(l, p, 2), [
  ["|one\ntwo\nthree", "|three"],
  ["one\n|two", "|one"],
]);

check("D", (l, p) => deleteToEnd(l, p), [
  ["ab|cd", "a|b"],
  ["|abcd", "|"],
  ["|", null],
]);

check("C leaves the cursor at the end for INSERT", (l, p) => deleteToEnd(l, p, true), [
  ["ab|cd", "ab|"],
]);

check("cc keeps the indent", changeLine, [
  ["  fo|o", "  |"],
  ["|foo", "|"],
]);

check("o and O copy the indent", (l, p) => openLine(l, p, true), [
  ["  f|oo\nbar", "  foo\n  |\nbar"],
]);

check("O", (l, p) => openLine(l, p, false), [
  ["foo\n  b|ar", "foo\n  |\n  bar"],
]);

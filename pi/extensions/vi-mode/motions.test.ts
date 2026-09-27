import assert from "node:assert/strict";
import { test } from "node:test";
import { charClass, BLANK, PUNCT, WORD } from "./chars.ts";
import { firstNonBlankMotion, left, lineEnd, right, vertical, wordBackward, wordEnd, wordForward, type Motion } from "./motions.ts";
import { parse, show } from "./testutil.ts";

type MotionFn = (lines: string[], pos: { line: number; col: number }) => Motion | null;

function check(name: string, fn: MotionFn, cases: [string, string][]) {
  test(name, () => {
    for (const [from, to] of cases) {
      const { lines, pos } = parse(from);
      // null: the motion fails, and the cursor stays.
      assert.equal(show(lines, fn(lines, pos)?.to ?? pos), to, `from ${JSON.stringify(from)}`);
    }
  });
}

test("character classes", () => {
  assert.equal(charClass(" "), BLANK);
  assert.equal(charClass("\t"), BLANK);
  assert.equal(charClass("a"), WORD);
  assert.equal(charClass("_"), WORD);
  assert.equal(charClass("é"), WORD);
  assert.equal(charClass("9"), WORD);
  assert.equal(charClass("."), PUNCT);
  assert.equal(charClass("("), PUNCT);
  assert.equal(charClass(".", true), WORD);
  assert.equal(charClass(" ", true), BLANK);
});

check("h stops at the line start", (l, p) => left(l, p), [
  ["ab|c", "a|bc"],
  ["|abc", "|abc"],
  ["x\n|y", "x\n|y"],
]);

check("l stops on the last character", (l, p) => right(l, p), [
  ["a|bc", "ab|c"],
  ["ab|c", "ab|c"],
  ["|", "|"],
]);

check("h and l step over whole graphemes", (l, p) => right(l, p), [
  ["|👍🏽x", "👍🏽|x"],
  ["|e\u0301x", "e\u0301|x"],
]);

test("j and k keep the wanted column across short lines", () => {
  const { lines, pos } = parse("abc|def\nx\nabcdefg");
  const down = vertical(lines, pos, 1, pos.col)!;
  assert.equal(show(lines, down.to), "abcdef\n|x\nabcdefg");
  assert.equal(show(lines, vertical(lines, down.to, 1, pos.col)!.to), "abcdef\nx\nabc|defg");
  assert.equal(vertical(lines, pos, -1, pos.col), null); // already on the first line
  assert.equal(show(lines, vertical(lines, down.to, 1, Infinity)!.to), "abcdef\nx\nabcdef|g");
});

check("^ goes to the first non-blank", firstNonBlankMotion, [
  ["  ab|c", "  |abc"],
  ["|  abc", "  |abc"],
  ["  |  ", "   | "],
]);

check("$ goes to the last character", lineEnd, [
  ["|abc", "ab|c"],
  ["|", "|"],
]);

check("w", (l, p) => wordForward(l, p), [
  ["|foo bar", "foo |bar"],
  ["|foo.bar", "foo|.bar"],
  ["foo|.bar", "foo.|bar"],
  ["|foo   bar", "foo   |bar"],
  ["f|oo\nbar", "foo\n|bar"],
  ["|foo\n\nbar", "foo\n|\nbar"],
  ["foo\n|\nbar", "foo\n\n|bar"],
  ["foo\n|\n  bar", "foo\n\n  |bar"],
  ["foo |bar", "foo ba|r"],
  ["|  foo", "  |foo"],
  ["|", "|"],
]);

check("W treats punctuation as part of the word", (l, p) => wordForward(l, p, 1, true), [
  ["|foo.bar baz", "foo.bar |baz"],
]);

check("b", (l, p) => wordBackward(l, p), [
  ["foo |bar", "|foo bar"],
  ["foo b|ar", "foo |bar"],
  ["foo.|bar", "foo|.bar"],
  ["foo\n|bar", "|foo\nbar"],
  ["foo\n\n|bar", "foo\n|\nbar"],
  ["  |foo", "|  foo"], // no earlier word: start of buffer, as in Vim
  ["|foo", "|foo"],
]);

check("e", (l, p) => wordEnd(l, p), [
  ["|foo bar", "fo|o bar"],
  ["fo|o bar", "foo ba|r"],
  ["|foo.bar", "fo|o.bar"],
  ["fo|o\n\nbar", "foo\n\nba|r"],
  ["foo ba|r", "foo ba|r"],
]);

check("counts repeat word motions", (l, p) => wordForward(l, p, 2), [
  ["|one two three", "one two |three"],
]);

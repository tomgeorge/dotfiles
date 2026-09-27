import assert from "node:assert/strict";
import { test } from "node:test";
import { prevCol } from "./chars.ts";
import { Engine } from "./engine.ts";
import { parse, show } from "./testutil.ts";

// Runs keys from NORMAL mode. Keys typed after entering INSERT are inserted
// as text until <Esc>, which returns to NORMAL like the editor does.
function run(keys: string, before: string, engine = new Engine()) {
  let { lines, pos } = parse(before);
  let mode: "normal" | "insert" = "normal";
  for (const k of keys.match(/<C-r>|<Esc>|./gu)!) {
    if (mode === "insert") {
      if (k === "<Esc>") {
        mode = "normal";
        pos = { line: pos.line, col: prevCol(lines[pos.line], pos.col) };
      } else {
        lines = lines.with(pos.line, lines[pos.line].slice(0, pos.col) + k + lines[pos.line].slice(pos.col));
        pos = { line: pos.line, col: pos.col + k.length };
      }
      continue;
    }
    if (k === "<Esc>") {
      engine.cancel();
      continue;
    }
    const a = engine.key(k, lines, pos);
    if (a.type === "move") pos = a.cursor;
    if (a.type === "insert") [pos, mode] = [a.cursor, "insert"];
    if (a.type === "edit") [lines, pos, mode] = [a.lines, a.cursor, a.insert ? "insert" : "normal"];
    if (a.type === "undo" || a.type === "redo") throw new Error("undo is the editor's job");
  }
  return { text: show(lines, pos), mode, engine };
}

function cases(name: string, list: [keys: string, before: string, after: string, mode?: "insert"][]) {
  test(name, () => {
    for (const [keys, before, after, mode = "normal"] of list) {
      const r = run(keys, before);
      assert.equal(r.text, after, `${keys} on ${JSON.stringify(before)}`);
      assert.equal(r.mode, mode, `${keys} on ${JSON.stringify(before)}: mode`);
    }
  });
}

cases("motions with counts", [
  ["3l", "|abcdef", "abc|def"],
  ["9l", "|abc", "ab|c"],
  ["2j", "|a\nb\nc\nd", "a\nb\n|c\nd"],
  ["2w", "|one two three", "one two |three"],
  ["2b", "one two |three", "|one two three"],
  ["2e", "|one two three", "one tw|o three"],
  ["ge", "one tw|o", "on|e two"],
  ["2ge", "one two th|ree", "on|e two three"],
  ["gE", "a.b c|d", "a.|b cd"],
  ["2$", "|ab\ncd\nef", "ab\nc|d\nef"],
]);

cases("gg and G land on the first non-blank", [
  ["G", "|a\nb\n  c", "a\nb\n  |c"],
  ["gg", "a\nb\n  |c", "|a\nb\n  c"],
  ["2G", "|a\n  b\nc", "a\n  |b\nc"],
  ["2gg", "|a\n  b\nc", "a\n  |b\nc"],
  ["9G", "|a\nb", "a\n|b"],
]);

cases("f t ; ,", [
  ["fc", "|abcabc", "ab|cabc"],
  ["2fc", "|abcabc", "abcab|c"],
  ["tc", "|abcabc", "a|bcabc"],
  ["Fa", "abca|bc", "abc|abc"],
  ["Ta", "abcab|c", "abca|bc"],
  ["fc;", "|abcabc", "abcab|c"],
  ["fc;,", "|abcabc", "ab|cabc"],
  ["tc;", "|abcabc", "abca|bc"], // ; after t jumps past the adjacent match
  ["fz", "|abc", "|abc"],
  ["fb", "|a\nb", "|a\nb"], // current line only
]);

cases("% and paragraphs", [
  ["%", "|f(a[b]c)", "f(a[b]c|)"],
  ["%", "f(a[b]c|)", "f|(a[b]c)"],
  ["%", "|if {\n  x\n}", "if {\n  x\n|}"],
  ["%", "|none", "|none"],
  ["}", "|a\nb\n\nc", "a\nb\n|\nc"],
  ["2}", "|a\n\nb\n\nc", "a\n\nb\n|\nc"],
  ["}", "a\n\n|cd", "a\n\nc|d"], // no blank line after: the end
  ["{", "a\n\nb\n|c", "a\n|\nb\nc"],
  ["{", "a\n|b", "|a\nb"],
]);

cases("d with motions", [
  ["dw", "|one two", "|two"],
  ["dw", "one |two", "one| "],
  ["dw", "f|oo\n  bar", "|f\n  bar"], // stops at the line end, not at bar
  ["d2w", "|a b c", "|c"],
  ["2d3w", "|a b c d e f g", "|g"],
  ["de", "|one two", "| two"],
  ["db", "one |two", "|two"],
  ["d$", "a|bc", "|a"],
  ["d0", "ab|c", "|c"],
  ["dl", "a|bc", "a|c"],
  ["dh", "a|bc", "|bc"],
  ["dj", "|a\nb\nc", "|c"],
  ["dk", "a\n|b\nc", "|c"],
  ["dG", "a\n|b\nc", "|a"],
  ["dgg", "a\n|b\nc", "|c"],
  ["dfc", "|abcd", "|d"],
  ["dtc", "|abcd", "|cd"],
  ["d%", "x|(a)y", "x|y"],
  ["d}", "|a\nb\n\nc", "|\nc"], // from the line start, whole lines
  ["dw", "|", "|"],
  ["dj", "a\n|b", "a\n|b"], // no line below: nothing
]);

cases("dd and counts", [
  ["dd", "|one\ntwo\nthree", "|two\nthree"],
  ["dd", "one\nt|wo\n  three", "one\n  |three"],
  ["dd", "one\ntwo\nth|ree", "one\n|two"],
  ["dd", "on|ly", "|"],
  ["2dd", "|one\ntwo\nthree", "|three"],
  ["5dd", "one\n|two\nthree", "|one"],
]);

cases("c", [
  ["cwX<Esc>", "|foo bar", "|X bar"], // cw acts like ce
  ["cwX<Esc>", "fo|o bar", "fo|X bar"], // on a word's end, just that character
  ["c2wX<Esc>", "|a b c", "|X c"],
  ["cw", "|foo bar", "| bar", "insert"],
  ["cc", "  fo|o\nbar", "  |\nbar", "insert"],
  ["C", "ab|cd", "ab|", "insert"],
  ["C", "|", "|", "insert"],
  ["s", "a|bc", "a|c", "insert"],
  ["s", "|", "|", "insert"],
  ["S", "  a|bc", "  |", "insert"],
  ["c$", "a|bc", "a|", "insert"],
]);

cases("simple edits", [
  ["x", "a|bc", "a|c"],
  ["x", "ab|c", "a|b"],
  ["3x", "|abcd", "|d"],
  ["x", "|", "|"],
  ["x", "|👍🏽x", "|x"],
  ["X", "ab|c", "a|c"],
  ["X", "|abc", "|abc"],
  ["D", "ab|cd", "a|b"],
  ["2D", "a|b\ncd\nef", "|a\nef"],
  ["rx", "a|bc", "a|xc"],
  ["3rx", "|abcd", "xx|xd"],
  ["5rx", "|abc", "|abc"],
  ["J", "|a\n  b", "a| b"],
  ["J", "|a \nb", "a |b"],
  ["J", "|f(\n)", "f(|)"],
  ["3J", "|a\nb\nc", "a b| c"],
  ["J", "|a", "|a"],
  ["~", "|abC", "A|bC"],
  ["3~", "|abC", "AB|c"],
  ["o", "  f|oo\nbar", "  foo\n  |\nbar", "insert"],
  ["O", "foo\n  b|ar", "foo\n  |\n  bar", "insert"],
  ["A", "a|bc", "abc|", "insert"],
  ["I", "  a|bc", "  |abc", "insert"],
  ["a", "a|bc", "ab|c", "insert"],
  ["a", "|", "|", "insert"],
]);

cases("yank and put", [
  ["yyp", "|one\ntwo", "one\n|one\ntwo"],
  ["yyP", "one\n|two", "one\n|two\ntwo"],
  ["yy2p", "|a", "a\n|a\na"],
  ["ywP", "|foo bar", "foo| foo bar"], // on the last character put
  ["yw$p", "|foo bar", "foo barfoo| "],
  ["ddp", "|one\ntwo", "two\n|one"],
  ["xp", "|ab", "b|a"],
  ["dwwP", "|a b c", "b a| c"],
  ["yiwP", "f|oo", "fo|ofoo"],
  ["p", "|abc", "|abc"], // empty register
  ['"_ddp', "|a\nb", "|b"], // black hole: nothing to put
  ["yj", "a|b\ncd", "a|b\ncd"],
  ["yk", "ab\nc|d", "a|b\ncd"],
  ["y$", "a|bc", "a|bc"],
  ["yb", "ab |cd", "|ab cd"],
  ["v", "|a", "|a"], // unmapped
]);

test("put of multi-line charwise text puts the cursor at its start", () => {
  const r = run("d%jp", "|(a\nb)x\nyz");
  assert.equal(r.text, "x\ny|(a\nb)z");
});

cases("text objects: words", [
  ["diw", "one t|wo three", "one | three"],
  ["daw", "one t|wo three", "one |three"],
  ["daw", "one t|wo", "on|e"], // no trailing blank: takes the leading one
  ["diw", "one| two", "one|two"], // on blanks, iw is the blanks
  ["daw", "one| two three", "one| three"],
  ["d2aw", "|a b c", "|c"],
  ["d3iw", "|a b c", "| c"],
  ["ciwX<Esc>", "a f|oo b", "a |X b"],
  ["diW", "a f.|o b", "a | b"],
  ["daw", "a.b|c d", "a.|d"],
  ["diw", "|", "|"],
]);

cases("text objects: brackets", [
  ["di(", "foo(a, |b) bar", "foo(|) bar"],
  ["ci(", "foo(a, |b) bar", "foo(|) bar", "insert"],
  ["da(", "foo(a, |b) bar", "foo| bar"],
  ["dib", "(|a)", "(|)"],
  ["di(", "|(a)", "(|)"], // on the opener
  ["di(", "(a|)", "(|)"], // on the closer
  ["di(", "f(a(|b)c)", "f(a(|)c)"],
  ["d2i(", "f(a(|b)c)", "f(|)"],
  ["di(", "f(|)", "f(|)"], // empty pair: nothing to delete
  ["ci(", "f(|)", "f(|)", "insert"],
  ["di(", "|none", "|none"],
  ["di{", "if {\n  |x\n}", "if {\n|}"],
  ["di{", "if {\n  |x\n  y\n}", "if {\n|}"],
  ["ci{", "if {\n  |x\n}", "if {\n  |\n}", "insert"],
  ["da{", "a {\n  |x\n} b", "a | b"],
  ["di[", "[1, |2]", "[|]"],
  ["di<", "<a|b>", "<|>"],
  ["di{", "{a, {|b}, c}", "{a, {|}, c}"],
  ["di(", "(a\n|b)", "(|)"],
]);

cases("text objects: quotes", [
  ['di"', 'say "he|llo" now', 'say "|" now'],
  ['da"', 'say "he|llo" now', "say |now"],
  ['da"', 'say "he|llo"', "sa|y"], // no trailing blank: takes the leading one
  ['di"', 'say "|hello"', 'say "|"'], // on the opening quote
  ['di"', 'say "hello|"', 'say "|"'], // on the closing quote
  ['di"', '|say "hello" now', 'say "|" now'], // before the first string
  ['di"', '"a" x| "b"', '"a" x "|"'], // between strings: the next one
  ['di"', '"a\\"|b"', '"|"'], // escaped quote
  ["di'", "it's '|x'", "it's '|x'"], // the apostrophe pairs first, as in Vim
  ['ci"', 'x = "|"', 'x = "|"', "insert"],
  ['di"', "|none", "|none"],
]);

cases("text objects: paragraphs", [
  ["dip", "a\n|b\n\nc", "|\nc"],
  ["dap", "a\n|b\n\nc", "|c"],
  ["dap", "a\n\nb\n|c", "|a"], // last paragraph: takes the blank line before
  ["yipP", "|a\nb\n\nc", "|a\nb\na\nb\n\nc"],
]);

test("register survives across commands", () => {
  const engine = new Engine();
  run("yiw", "|foo bar", engine);
  assert.deepEqual(engine.register, { text: "foo", linewise: false });
  assert.equal(run("wP", "|x y", engine).text, "x fo|oy");
});

test("Esc cancels a pending command", () => {
  assert.equal(run("d<Esc>w", "|one two").text, "one |two");
  assert.equal(run("2<Esc>x", "|abc").text, "|bc");
});

test("j/k keep the column; $ sticks to the line end", () => {
  assert.equal(run("jj", "abc|def\nx\nabcdefg").text, "abcdef\nx\nabc|defg");
  assert.equal(run("$jj", "a|b\nx\nabcdefg").text, "ab\nx\nabcdef|g");
  assert.equal(run("jhk", "ab|c\nabc").text, "a|bc\nabc");
});

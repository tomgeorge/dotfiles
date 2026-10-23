import assert from "node:assert/strict";
import { test } from "node:test";
import type { LeaderGroup, LeaderOption } from "./leaderRegistry.ts";
import { MAX_LINES, columnsFor, plainStyle, whichKeyLines, type WhichKeyColor, type WhichKeyStyle } from "./whichKey.ts";

const leaf = (key: string, label: string, detail?: string): LeaderOption => ({
  key,
  label,
  ...(detail ? { detail } : {}),
  hasChildren: false,
  target: { command: { name: label } },
});

const CREW: LeaderGroup = {
  label: "crew",
  options: [leaf("c", "clean", "remove finished crews"), leaf("l", "list", "every crew in the repo"), leaf("r", "resume"), leaf("s", "status", "open the crew panel")],
};

const KEYS = "abcdefghijklmnopqrstuvwxyz0123456789";
const many = (n: number, detail = true): LeaderGroup => ({
  label: "leader",
  options: [...KEYS.slice(0, n)].map((k) => leaf(k, `opt ${k}`, detail ? `detail ${k}` : undefined)),
});

// How many cards sit on the first grid row: count the labels.
const badgesOnFirstRow = (lines: string[]): number => (lines[1]?.match(/opt [a-z0-9]/g) ?? []).length;
// Two cells of a 60-wide grid: 29 columns each, then a two-space gap.
const row2 = (a: string, b: string): string => a.padEnd(31) + b;
const HINT = "esc cancel · backspace up";
const head = (crumb: string, width: number): string => crumb.padEnd(width - HINT.length) + HINT;

test("the column count depends only on width", () => {
  assert.equal(columnsFor(40), 1);
  assert.equal(columnsFor(55), 1);
  assert.equal(columnsFor(56), 2);
  assert.equal(columnsFor(60), 2);
  assert.equal(columnsFor(89), 2);
  assert.equal(columnsFor(90), 3);
  assert.equal(columnsFor(100), 3);
  assert.equal(columnsFor(129), 3);
  assert.equal(columnsFor(130), 4);
  assert.equal(columnsFor(140), 4);
});

test("cards land on that many columns at widths 40, 60, 100 and 140", () => {
  for (const [width, columns] of [[40, 1], [60, 2], [100, 3], [140, 4]] as const) {
    const lines = whichKeyLines(many(8), [], "SPC", width, plainStyle);
    assert.equal(badgesOnFirstRow(lines), columns, `width ${width}`);
    assert.equal(lines.length, 1 + Math.ceil(8 / columns) * 2, `width ${width}`);
    for (const line of lines) assert.ok(line.length <= width, `width ${width}: ${JSON.stringify(line)}`);
  }
});

test("each option is a two-line card: badge and label, then the detail under the label", () => {
  const lines = whichKeyLines(CREW, ["c"], "SPC", 60, plainStyle);
  assert.deepEqual(lines, [
    head("SPC › c / crew", 60),
    row2(" c  clean", " l  list"),
    row2("    remove finished crews", "    every crew in the repo"),
    row2(" r  resume", " s  status"),
    row2("", "    open the crew panel"),
  ]);
});

test("the breadcrumb uses the leader's name, SPC or \\", () => {
  assert.equal(whichKeyLines(CREW, ["c"], "SPC", 60, plainStyle)[0]?.startsWith("SPC › c / crew "), true);
  assert.equal(whichKeyLines(CREW, ["c"], "\\", 60, plainStyle)[0]?.startsWith("\\ › c / crew "), true);
  const root = whichKeyLines({ label: "leader", options: [] }, [], "SPC", 60, plainStyle);
  assert.deepEqual(root, [head("SPC / leader", 60)]);
  const deep = whichKeyLines({ label: "deep", options: [] }, ["a", "b"], "\\", 60, plainStyle);
  assert.equal(deep[0]?.startsWith("\\ › a › b / deep"), true);
});

test("the hint is dropped before the breadcrumb when the header is narrow", () => {
  assert.deepEqual(whichKeyLines(CREW, ["c"], "SPC", 30, plainStyle)[0], "SPC › c / crew");
  assert.deepEqual(whichKeyLines(CREW, ["c"], "SPC", 10, plainStyle)[0], "SPC › c /…");
});

test("long labels and details are cut with …", () => {
  const group: LeaderGroup = { label: "g", options: [leaf("a", "a label far too long for it", "a detail much longer than the cell it sits in")] };
  const lines = whichKeyLines(group, [], "SPC", 24, plainStyle);
  assert.deepEqual(lines.slice(1), [" a  a label far too lon…", "    a detail much longe…"]);
  for (const line of lines) assert.ok(line.length <= 24);
});

test("group options get a + marker", () => {
  const group: LeaderGroup = { label: "leader", options: [{ key: "c", label: "crew", hasChildren: true }, leaf("q", "quit")] };
  const lines = whichKeyLines(group, [], "SPC", 40, plainStyle);
  assert.equal(lines[1], " c  +crew");
  assert.equal(lines[3], " q  quit");
});

test("the panel stays within 21 lines: details go first, then options", () => {
  // 10 rows of two-line cards fit under the header exactly.
  assert.equal(whichKeyLines(many(10), [], "SPC", 40, plainStyle).length, MAX_LINES);
  assert.ok(whichKeyLines(many(10), [], "SPC", 40, plainStyle).includes("    detail j"));

  // 11 rows don't, so the details go and every option stays.
  const dense = whichKeyLines(many(11), [], "SPC", 40, plainStyle);
  assert.equal(dense.length, 12);
  assert.ok(!dense.some((l) => l.includes("detail")));
  assert.equal(dense.at(-1), " k  opt k");

  // Past 20 rows even single lines don't fit; the last line counts the rest.
  const cut = whichKeyLines(many(36), [], "SPC", 40, plainStyle);
  assert.equal(cut.length, MAX_LINES);
  assert.equal(cut.at(-2), " s  opt s");
  assert.equal(cut.at(-1), "… 17 more");

  // Wider grids fit them all.
  for (const width of [60, 100, 140]) assert.ok(whichKeyLines(many(36), [], "SPC", width, plainStyle).length <= MAX_LINES);
  assert.ok(!whichKeyLines(many(36), [], "SPC", 60, plainStyle).some((l) => l.includes("more")));
});

test("tone exit paints the badge in the warning colour", () => {
  const calls: { color: WhichKeyColor; text: string }[] = [];
  const spy: WhichKeyStyle = { ...plainStyle, fg: (color, text) => (calls.push({ color, text }), text) };
  const group: LeaderGroup = { label: "crew", options: [{ ...leaf("x", "stop"), tone: "exit" }, leaf("s", "status")] };
  whichKeyLines(group, ["c"], "SPC", 60, spy);
  assert.deepEqual(calls.find((c) => c.text === " x "), { color: "warning", text: " x " });
  assert.deepEqual(calls.find((c) => c.text === " s "), { color: "accent", text: " s " });
});

test("styling doesn't break alignment: widths are measured on plain text", () => {
  const ansi: WhichKeyStyle = {
    fg: (_c, text) => `\x1b[33m${text}\x1b[39m`,
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    inverse: (text) => `\x1b[7m${text}\x1b[27m`,
    visibleWidth: (text) => [...text.replace(/\x1b\[[0-9;]*m/g, "")].length,
    truncate: plainStyle.truncate,
  };
  const strip = (l: string): string => l.replace(/\x1b\[[0-9;]*m/g, "");
  assert.deepEqual(whichKeyLines(CREW, ["c"], "SPC", 60, ansi).map(strip), whichKeyLines(CREW, ["c"], "SPC", 60, plainStyle));
});

test("zero width draws nothing", () => {
  assert.deepEqual(whichKeyLines(CREW, ["c"], "SPC", 0, plainStyle), []);
});

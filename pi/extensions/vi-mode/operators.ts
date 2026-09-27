// Pure edits. Each takes the buffer and returns the new buffer, cursor and,
// for d/c/y, what goes in the register. The editor applies one as a single
// undo step.

import { before, firstNonBlank, graphemeStarts, lastCol, nextCol, snapCol, type Pos, type Range } from "./chars.ts";
import type { Motion } from "./motions.ts";

export type Register = { text: string; linewise: boolean };
export type Edit = { lines: string[]; cursor: Pos };
export type OpResult = Edit & { register: Register | null; insert: boolean };

const indentOf = (line: string) => /^\s*/u.exec(line)![0];

// The range a motion from `from` covers, with Vim's rules for exclusive
// motions that end at the start of a line (:h exclusive).
export function motionRange(lines: string[], from: Pos, motion: Motion): Range {
  let [start, end] = before(motion.to, from) ? [motion.to, from] : [from, motion.to];
  if (motion.kind === "linewise") return { start, end, linewise: true };
  if (motion.kind === "inclusive") return { start, end: { line: end.line, col: nextCol(lines[end.line], end.col) }, linewise: false };
  if (end.col === 0 && end.line > start.line) {
    // d} from a line's start takes whole lines; otherwise stop before the
    // line break.
    if (start.col <= firstNonBlank(lines[start.line])) {
      return { start, end: { line: end.line - 1, col: 0 }, linewise: true };
    }
    end = { line: end.line - 1, col: lines[end.line - 1].length };
  }
  return { start, end, linewise: false };
}

// count lines from pos.line, as far as the buffer goes: dd, cc, yy.
export function lineRange(lines: string[], pos: Pos, count = 1): Range {
  const last = Math.min(lines.length - 1, pos.line + count - 1);
  return { start: { line: pos.line, col: 0 }, end: { line: last, col: 0 }, linewise: true };
}

export function textOf(lines: string[], r: Range): string {
  if (r.linewise) return lines.slice(r.start.line, r.end.line + 1).join("\n");
  if (r.start.line === r.end.line) return lines[r.start.line].slice(r.start.col, r.end.col);
  return [
    lines[r.start.line].slice(r.start.col),
    ...lines.slice(r.start.line + 1, r.end.line),
    lines[r.end.line].slice(0, r.end.col),
  ].join("\n");
}

function removeChars(lines: string[], r: Range): string[] {
  const joined = lines[r.start.line].slice(0, r.start.col) + lines[r.end.line].slice(r.end.col);
  return lines.toSpliced(r.start.line, r.end.line - r.start.line + 1, joined);
}

// d, c and y. cursor is where the command started (y on lines keeps its
// column).
export function operate(op: "d" | "c" | "y", lines: string[], r: Range, cursor: Pos): OpResult {
  const register = { text: textOf(lines, r), linewise: r.linewise };
  if (op === "y") {
    const to = r.linewise ? { line: r.start.line, col: cursor.line === r.start.line ? cursor.col : Math.min(cursor.col, lastCol(lines[r.start.line])) } : r.start;
    return { lines, cursor: to, register, insert: false };
  }
  if (r.linewise && op === "c") {
    const indent = indentOf(lines[r.start.line]);
    const out = lines.toSpliced(r.start.line, r.end.line - r.start.line + 1, indent);
    return { lines: out, cursor: { line: r.start.line, col: indent.length }, register, insert: true };
  }
  if (r.linewise) {
    let out = lines.toSpliced(r.start.line, r.end.line - r.start.line + 1);
    if (out.length === 0) out = [""];
    const line = Math.min(r.start.line, out.length - 1);
    return { lines: out, cursor: { line, col: firstNonBlank(out[line]) }, register, insert: false };
  }
  return { lines: removeChars(lines, r), cursor: r.start, register, insert: op === "c" };
}

// p / P. Linewise text goes below/above the line; charwise text after/at the
// cursor. The cursor ends on the first non-blank of linewise text, on the
// last character of single-line text, and at the start of multi-line text.
export function put(lines: string[], pos: Pos, reg: Register, after: boolean, count = 1): Edit {
  if (reg.linewise) {
    const added = Array.from({ length: count }, () => reg.text.split("\n")).flat();
    const at = after ? pos.line + 1 : pos.line;
    return { lines: lines.toSpliced(at, 0, ...added), cursor: { line: at, col: firstNonBlank(added[0]) } };
  }
  const text = reg.text.repeat(count);
  const line = lines[pos.line];
  const col = after && line.length > 0 ? nextCol(line, pos.col) : pos.col;
  const parts = (line.slice(0, col) + text + line.slice(col)).split("\n");
  const out = lines.toSpliced(pos.line, 1, ...parts);
  if (parts.length > 1) return { lines: out, cursor: { line: pos.line, col } };
  return { lines: out, cursor: { line: pos.line, col: snapCol(out[pos.line], col + text.length - 1) } };
}

// r{c}: replace count characters. Fails if there aren't that many.
export function replaceChars(lines: string[], pos: Pos, ch: string, count = 1): Edit | null {
  const line = lines[pos.line];
  const starts = graphemeStarts(line);
  const i = starts.indexOf(pos.col);
  if (i < 0 || i + count > starts.length) return null;
  const end = starts[i + count] ?? line.length;
  const text = line.slice(0, pos.col) + ch.repeat(count) + line.slice(end);
  return { lines: lines.with(pos.line, text), cursor: { line: pos.line, col: pos.col + ch.length * (count - 1) } };
}

// J: join count lines (at least two), dropping the next line's indent and
// putting one space between, except before ")" or after a trailing space.
export function joinLines(lines: string[], pos: Pos, count = 2): Edit | null {
  const joins = Math.max(1, count - 1);
  if (pos.line + 1 >= lines.length) return null;
  let text = lines[pos.line];
  let col = 0;
  const last = Math.min(lines.length - 1, pos.line + joins);
  for (let l = pos.line + 1; l <= last; l++) {
    const next = lines[l].replace(/^\s+/u, "");
    const space = text === "" || next === "" || /\s$/u.test(text) || next.startsWith(")") ? "" : " ";
    // On the inserted space, or where the joined text starts.
    col = text.length;
    text += space + next;
  }
  return { lines: lines.toSpliced(pos.line, last - pos.line + 1, text), cursor: { line: pos.line, col } };
}

// ~: toggle the case of count characters and step past them.
export function toggleCase(lines: string[], pos: Pos, count = 1): Edit | null {
  const line = lines[pos.line];
  if (line.length === 0) return null;
  let end = pos.col;
  for (let i = 0; i < count && end < line.length; i++) end = nextCol(line, end);
  const swapped = [...line.slice(pos.col, end)].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
  const text = line.slice(0, pos.col) + swapped + line.slice(end);
  return { lines: lines.with(pos.line, text), cursor: { line: pos.line, col: Math.min(end, lastCol(text)) } };
}

// o / O: open an empty line below or above, with the current line's indent.
export function openLine(lines: string[], pos: Pos, below: boolean): Edit {
  const indent = indentOf(lines[pos.line]);
  const at = below ? pos.line + 1 : pos.line;
  return { lines: lines.toSpliced(at, 0, indent), cursor: { line: at, col: indent.length } };
}

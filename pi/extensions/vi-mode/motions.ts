// Pure motions over (lines, cursor). They know nothing about Pi, so they can
// be tested with plain arrays.

import { BLANK, charClass, firstNonBlank, graphemeStarts, lastCol, nextCol, prevCol, snapCol, type Pos } from "./chars.ts";

export type MotionKind = "exclusive" | "inclusive" | "linewise";
export type Motion = { to: Pos; kind: MotionKind };

export function left(lines: string[], pos: Pos, count = 1): Motion | null {
  if (pos.col === 0) return null;
  let col = pos.col;
  for (let i = 0; i < count && col > 0; i++) col = prevCol(lines[pos.line], col);
  return { to: { line: pos.line, col }, kind: "exclusive" };
}

// NORMAL's cursor stops on the last character; an operator (dl, x) may reach
// past it to take that character.
export function right(lines: string[], pos: Pos, count = 1, forOperator = false): Motion | null {
  const line = lines[pos.line];
  const max = forOperator ? line.length : lastCol(line);
  if (pos.col >= max) return null;
  let col = pos.col;
  for (let i = 0; i < count && col < max; i++) col = nextCol(line, col);
  return { to: { line: pos.line, col: Math.min(col, max) }, kind: "exclusive" };
}

// j/k move by logical lines, unlike the base editor's arrows (visual rows,
// and history at the top). want is the sticky column; Infinity after `$`.
export function vertical(lines: string[], pos: Pos, delta: number, want: number): Motion | null {
  const line = Math.max(0, Math.min(lines.length - 1, pos.line + delta));
  if (line === pos.line) return null;
  return { to: { line, col: columnFor(lines[line], want) }, kind: "linewise" };
}

export function columnFor(text: string, want: number): number {
  return want === Infinity ? lastCol(text) : snapCol(text, Math.min(want, lastCol(text)));
}

export function lineStart(_lines: string[], pos: Pos): Motion {
  return { to: { line: pos.line, col: 0 }, kind: "exclusive" };
}

export function firstNonBlankMotion(lines: string[], pos: Pos): Motion {
  return { to: { line: pos.line, col: firstNonBlank(lines[pos.line]) }, kind: "exclusive" };
}

// N$ moves N-1 lines down first.
export function lineEnd(lines: string[], pos: Pos, count = 1): Motion {
  const line = Math.min(lines.length - 1, pos.line + count - 1);
  return { to: { line, col: lastCol(lines[line]) }, kind: "inclusive" };
}

// gg and G: to line n (1-based), or the first/last line without a count.
export function gotoLine(lines: string[], n: number): Motion {
  const line = Math.max(0, Math.min(lines.length - 1, n - 1));
  return { to: { line, col: firstNonBlank(lines[line]) }, kind: "linewise" };
}

// One entry per grapheme, plus a blank at each line break. An empty line is
// its own entry, which w, b and ge stop on and e skips, as in Vim.
type Cell = { line: number; col: number; cls: number; empty?: boolean; eol?: boolean };

function cells(lines: string[], big: boolean): Cell[] {
  const out: Cell[] = [];
  lines.forEach((text, line) => {
    if (text.length === 0) {
      out.push({ line, col: 0, cls: BLANK, empty: true });
    } else {
      const starts = graphemeStarts(text);
      starts.forEach((col, i) => {
        out.push({ line, col, cls: charClass(text.slice(col, starts[i + 1] ?? text.length), big) });
      });
    }
    if (line < lines.length - 1) out.push({ line, col: text.length, cls: BLANK, eol: true });
  });
  return out;
}

function indexOf(cs: Cell[], pos: Pos): number {
  const i = cs.findIndex((c) => c.line === pos.line && c.col >= pos.col && !c.eol);
  if (i >= 0) return i;
  // Past the end of the line (INSERT's col == len): use its last cell.
  const j = cs.findLastIndex((c) => c.line === pos.line && !c.eol);
  return j >= 0 ? j : 0;
}

const stop = (c: Cell) => c.empty || c.cls !== BLANK;
const toPos = (c: Cell): Pos => ({ line: c.line, col: c.col });
const sameWord = (a: Cell, b: Cell) => !a.empty && !b.empty && a.cls === b.cls && a.cls !== BLANK;

// Index of the next word start after i, or cs.length if there's none.
function nextWordStart(cs: Cell[], i: number): number {
  const start = cs[i];
  i++;
  if (start.cls !== BLANK && !start.empty) while (i < cs.length && sameWord(cs[i], start)) i++;
  while (i < cs.length && !stop(cs[i])) i++;
  return i;
}

export function wordForward(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count; n++) {
    const next = nextWordStart(cs, i);
    if (next >= cs.length) {
      // No next word: Vim lands on the last character.
      i = cs.length - 1;
      break;
    }
    i = next;
  }
  return { to: toPos(cs[i]), kind: "exclusive" };
}

// w for an operator (dw, yw). If the last word moved over ends its line, the
// operation stops at that line's end rather than taking the line break and
// the next line's indent (:h exclusive, "Another special case").
export function wordForwardOp(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count; n++) {
    const next = nextWordStart(cs, i);
    const last = n === count - 1;
    if (next >= cs.length || (last && cs[next].line > cs[i].line)) {
      const line = cs[i].line;
      // An empty line counts as a word; dw on it takes the line break.
      if (cs[i].empty && next < cs.length) return { to: toPos(cs[next]), kind: "exclusive" };
      return { to: { line, col: lines[line].length }, kind: "exclusive" };
    }
    i = next;
  }
  return { to: toPos(cs[i]), kind: "exclusive" };
}

export function wordBackward(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count && i > 0; n++) {
    i--;
    while (i > 0 && !stop(cs[i])) i--;
    if (!cs[i].empty) while (i > 0 && sameWord(cs[i - 1], cs[i])) i--;
  }
  return { to: toPos(cs[i]), kind: "exclusive" };
}

export function wordEnd(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count && i < cs.length - 1; n++) {
    i++;
    while (i < cs.length - 1 && cs[i].cls === BLANK) i++;
    while (i < cs.length - 1 && sameWord(cs[i + 1], cs[i])) i++;
  }
  return { to: toPos(cs[i]), kind: "inclusive" };
}

// cw / cW on a non-blank: like ce, but a cursor already on a word's last
// character changes just that character (:h cw).
export function changeWordEnd(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  const i = indexOf(cs, pos);
  const atEnd = i + 1 >= cs.length || !sameWord(cs[i + 1], cs[i]);
  const n = atEnd ? count - 1 : count;
  return n > 0 ? wordEnd(lines, pos, n, big) : { to: toPos(cs[i]), kind: "inclusive" };
}

// ge / gE: end of the previous word. Stops on empty lines.
export function wordEndBackward(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count && i > 0; n++) {
    const start = cs[i];
    if (start.cls !== BLANK && !start.empty) while (i > 0 && sameWord(cs[i], start)) i--;
    else i--;
    while (i > 0 && cs[i].cls === BLANK && !cs[i].empty) i--;
  }
  return { to: toPos(cs[i]), kind: "inclusive" };
}

export type Find = { key: "f" | "F" | "t" | "T"; char: string };

// f F t T, on the current line only. again: ; and , repeating a t/T, which
// skip a match right next to the cursor so they don't get stuck on it.
export function findChar(lines: string[], pos: Pos, find: Find, count = 1, again = false): Motion | null {
  const text = lines[pos.line];
  const starts = graphemeStarts(text);
  const at = starts.indexOf(snapCol(text, pos.col));
  const forward = find.key === "f" || find.key === "t";
  const till = find.key === "t" || find.key === "T";
  const step = forward ? 1 : -1;
  let i = at;
  if (till && again) i += step;
  let found = -1;
  for (let n = 0; n < count; n++) {
    i += step;
    while (i >= 0 && i < starts.length && text.slice(starts[i], starts[i + 1] ?? text.length) !== find.char) i += step;
    if (i < 0 || i >= starts.length) return null;
    found = i;
  }
  if (till) found -= step;
  return { to: { line: pos.line, col: starts[found] }, kind: forward ? "inclusive" : "exclusive" };
}

export function reverseFind(find: Find): Find {
  const flip = { f: "F", F: "f", t: "T", T: "t" } as const;
  return { key: flip[find.key], char: find.char };
}

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

// %: the bracket matching the one under or after the cursor on this line.
export function matchPair(lines: string[], pos: Pos): Motion | null {
  const text = lines[pos.line];
  let col = pos.col;
  while (col < text.length && !(text[col] in PAIRS) && !(text[col] in CLOSERS)) col++;
  if (col >= text.length) return null;
  const ch = text[col];
  const forward = ch in PAIRS;
  const other = forward ? PAIRS[ch] : CLOSERS[ch];
  let depth = 0;
  let line = pos.line;
  let c = col;
  for (;;) {
    const t = lines[line];
    if (t[c] === ch) depth++;
    else if (t[c] === other && --depth === 0) return { to: { line, col: c }, kind: "inclusive" };
    if (forward) {
      c++;
      while (c >= lines[line].length) {
        if (++line >= lines.length) return null;
        c = 0;
        if (lines[line].length > 0) break;
      }
    } else {
      c--;
      while (c < 0) {
        if (--line < 0) return null;
        c = lines[line].length - 1;
      }
    }
  }
}

// { and }: the previous/next empty line, or the buffer's start/end.
export function paragraph(lines: string[], pos: Pos, count: number, forward: boolean): Motion {
  const step = forward ? 1 : -1;
  let line = pos.line;
  for (let n = 0; n < count; n++) {
    // Skip empty lines we're on, then non-empty ones, to the next empty.
    while (line + step >= 0 && line + step < lines.length && lines[line] === "") line += step;
    while (line + step >= 0 && line + step < lines.length && lines[line + step] !== "") line += step;
    line += step;
    if (line < 0 || line >= lines.length) {
      if (forward) return { to: { line: lines.length - 1, col: lastCol(lines.at(-1)!) }, kind: "inclusive" };
      return { to: { line: 0, col: 0 }, kind: "exclusive" };
    }
  }
  return { to: { line, col: 0 }, kind: "exclusive" };
}

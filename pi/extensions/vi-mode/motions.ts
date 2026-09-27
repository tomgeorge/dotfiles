// Pure motions over (lines, cursor). They know nothing about Pi, so they can
// be tested with plain arrays.

import { BLANK, charClass, firstNonBlank, graphemeStarts, lastCol, nextCol, prevCol, snapCol, type Pos } from "./chars.ts";

export type MotionKind = "exclusive" | "inclusive" | "linewise";
export type Motion = { to: Pos; kind: MotionKind };

export function left(lines: string[], pos: Pos, count = 1): Motion {
  let col = pos.col;
  for (let i = 0; i < count; i++) col = prevCol(lines[pos.line], col);
  return { to: { line: pos.line, col }, kind: "exclusive" };
}

// Stops on the last character, as NORMAL mode's cursor can't pass it.
export function right(lines: string[], pos: Pos, count = 1): Motion {
  const line = lines[pos.line];
  const max = lastCol(line);
  let col = pos.col;
  for (let i = 0; i < count && col < max; i++) col = nextCol(line, col);
  return { to: { line: pos.line, col: Math.min(col, max) }, kind: "exclusive" };
}

// j/k move by logical lines, unlike the base editor's arrows (visual rows,
// and history at the top). want is the sticky column; Infinity after `$`.
export function vertical(lines: string[], pos: Pos, delta: number, want: number): Motion {
  const line = Math.max(0, Math.min(lines.length - 1, pos.line + delta));
  const text = lines[line];
  const col = want === Infinity ? lastCol(text) : snapCol(text, Math.min(want, lastCol(text)));
  return { to: { line, col }, kind: "linewise" };
}

export function lineStart(_lines: string[], pos: Pos): Motion {
  return { to: { line: pos.line, col: 0 }, kind: "exclusive" };
}

export function firstNonBlankMotion(lines: string[], pos: Pos): Motion {
  return { to: { line: pos.line, col: firstNonBlank(lines[pos.line]) }, kind: "exclusive" };
}

export function lineEnd(lines: string[], pos: Pos): Motion {
  return { to: { line: pos.line, col: lastCol(lines[pos.line]) }, kind: "inclusive" };
}

// One entry per grapheme, plus a blank at each line break. An empty line is
// its own entry, which w and b stop on and e skips, as in Vim.
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

export function wordForward(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count; n++) {
    const start = cs[i];
    if (start.empty) i++;
    else if (start.cls !== BLANK) while (i < cs.length && !cs[i].empty && cs[i].cls === start.cls) i++;
    while (i < cs.length && !stop(cs[i])) i++;
    if (i >= cs.length) {
      // No next word: Vim lands on the last character.
      i = cs.length - 1;
      break;
    }
  }
  return { to: toPos(cs[i]), kind: "exclusive" };
}

export function wordBackward(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count && i > 0; n++) {
    i--;
    while (i > 0 && !stop(cs[i])) i--;
    const cls = cs[i].cls;
    if (!cs[i].empty) while (i > 0 && !cs[i - 1].empty && cs[i - 1].cls === cls && cls !== BLANK) i--;
  }
  return { to: toPos(cs[i]), kind: "exclusive" };
}

export function wordEnd(lines: string[], pos: Pos, count = 1, big = false): Motion {
  const cs = cells(lines, big);
  let i = indexOf(cs, pos);
  for (let n = 0; n < count && i < cs.length - 1; n++) {
    i++;
    while (i < cs.length - 1 && cs[i].cls === BLANK) i++;
    const cls = cs[i].cls;
    while (i < cs.length - 1 && cs[i + 1].cls === cls && cls !== BLANK && !cs[i + 1].empty) i++;
  }
  return { to: toPos(cs[i]), kind: "inclusive" };
}

// Pure edits: each takes (lines, cursor) and returns the new buffer and
// cursor. The editor applies one as a single undo step.
//
// These are the fixed commands Crawl needs (x dd D cc C o O). Walk replaces
// them with operators over motion ranges.

import { firstNonBlank, lastCol, nextCol, type Pos } from "./chars.ts";

export type Edit = { lines: string[]; cursor: Pos };

// x: delete count characters under and after the cursor, within the line.
export function deleteChars(lines: string[], pos: Pos, count = 1): Edit | null {
  const line = lines[pos.line];
  if (line.length === 0) return null;
  let end = pos.col;
  for (let i = 0; i < count && end < line.length; i++) end = nextCol(line, end);
  const text = line.slice(0, pos.col) + line.slice(end);
  const out = lines.with(pos.line, text);
  return { lines: out, cursor: { line: pos.line, col: Math.min(pos.col, lastCol(text)) } };
}

// dd: delete count lines. The cursor goes to the first non-blank of the line
// that takes their place.
export function deleteLines(lines: string[], pos: Pos, count = 1): Edit {
  const out = lines.toSpliced(pos.line, count);
  if (out.length === 0) return { lines: [""], cursor: { line: 0, col: 0 } };
  const line = Math.min(pos.line, out.length - 1);
  return { lines: out, cursor: { line, col: firstNonBlank(out[line]) } };
}

// D (and C, which then enters INSERT at the returned cursor).
export function deleteToEnd(lines: string[], pos: Pos, insert = false): Edit | null {
  const line = lines[pos.line];
  if (pos.col >= line.length) return null;
  const text = line.slice(0, pos.col);
  const col = insert ? text.length : lastCol(text);
  return { lines: lines.with(pos.line, text), cursor: { line: pos.line, col } };
}

// cc: empty the line but keep its indent, and put the cursor after it.
export function changeLine(lines: string[], pos: Pos): Edit {
  const indent = /^\s*/u.exec(lines[pos.line])![0];
  return { lines: lines.with(pos.line, indent), cursor: { line: pos.line, col: indent.length } };
}

// o / O: open an empty line below or above, with the current line's indent.
export function openLine(lines: string[], pos: Pos, below: boolean): Edit {
  const indent = /^\s*/u.exec(lines[pos.line])![0];
  const at = below ? pos.line + 1 : pos.line;
  return { lines: lines.toSpliced(at, 0, indent), cursor: { line: at, col: indent.length } };
}

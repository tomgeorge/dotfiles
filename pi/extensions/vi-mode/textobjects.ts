// Text objects for operators: d i w, c a (, y i ", and so on. Each returns
// the Range to operate on, or null when there's no such object here.

import { BLANK, charClass, graphemeStarts, type Pos, type Range } from "./chars.ts";

export function textObject(lines: string[], pos: Pos, key: string, inner: boolean, count = 1): Range | null {
  switch (key) {
    case "w":
    case "W":
      return word(lines, pos, inner, count, key === "W");
    case "(":
    case ")":
    case "b":
      return bracket(lines, pos, "(", ")", inner, count);
    case "{":
    case "}":
    case "B":
      return bracket(lines, pos, "{", "}", inner, count);
    case "[":
    case "]":
      return bracket(lines, pos, "[", "]", inner, count);
    case "<":
    case ">":
      return bracket(lines, pos, "<", ">", inner, count);
    case '"':
    case "'":
    case "`":
      return quote(lines, pos, key, inner);
    case "p":
      return paragraphObject(lines, pos, inner, count);
  }
  return null;
}

type Run = { start: number; end: number; blank: boolean };

// The line split into runs of one character class (blanks are a run too).
function runs(line: string, big: boolean): Run[] {
  const starts = graphemeStarts(line);
  const out: Run[] = [];
  let cls = -1;
  starts.forEach((col, i) => {
    const c = charClass(line.slice(col, starts[i + 1] ?? line.length), big);
    if (c !== cls) out.push({ start: col, end: col, blank: c === BLANK });
    out.at(-1)!.end = starts[i + 1] ?? line.length;
    cls = c;
  });
  return out;
}

// iw: the run under the cursor, blanks included, and count-1 runs after it.
// aw: words with their trailing blanks, or leading blanks when a word has
// none after it; from blanks, the blanks and the next word. Current line
// only.
function word(lines: string[], pos: Pos, inner: boolean, count: number, big: boolean): Range | null {
  const line = lines[pos.line];
  const rs = runs(line, big);
  const r = rs.findIndex((x) => pos.col >= x.start && pos.col < x.end);
  if (r < 0) return null;
  // Each word, and each blank run, is one run; aw takes them in pairs.
  const last = Math.min(rs.length - 1, r + (inner ? count : 2 * count) - 1);
  let start = rs[r].start;
  if (!inner && !rs[r].blank && !rs[last].blank && r > 0 && rs[r - 1].blank) {
    // Ends on a word with no blank after it: take the blank before instead.
    start = rs[r - 1].start;
  }
  const end = rs[last].end;
  return { start: { line: pos.line, col: start }, end: { line: pos.line, col: end }, linewise: false };
}

// Step one character forward or backward across lines, skipping line breaks.
function step(lines: string[], p: Pos, dir: 1 | -1): Pos | null {
  let { line, col } = p;
  col += dir;
  while (col < 0 || col >= lines[line].length) {
    line += dir;
    if (line < 0 || line >= lines.length) return null;
    col = dir === 1 ? 0 : lines[line].length - 1;
  }
  return { line, col };
}

const charAt = (lines: string[], p: Pos) => lines[p.line][p.col];

function findOpen(lines: string[], from: Pos | null, open: string, close: string, skipCloseAtStart: boolean): Pos | null {
  let p = from;
  if (p && skipCloseAtStart && charAt(lines, p) === close) p = step(lines, p, -1);
  let depth = 0;
  for (; p; p = step(lines, p, -1)) {
    const c = charAt(lines, p);
    if (c === close) depth++;
    else if (c === open) {
      if (depth === 0) return p;
      depth--;
    }
  }
  return null;
}

function findClose(lines: string[], open: Pos, openCh: string, close: string): Pos | null {
  let depth = 0;
  for (let p = step(lines, open, 1); p; p = step(lines, p, 1)) {
    const c = charAt(lines, p);
    if (c === openCh) depth++;
    else if (c === close) {
      if (depth === 0) return p;
      depth--;
    }
  }
  return null;
}

// i( a( and friends. A cursor on either bracket is inside that pair; a count
// selects enclosing pairs. When the brackets sit alone on their lines around
// the content, i{ is linewise, so di{ keeps { and } on their own lines.
function bracket(lines: string[], pos: Pos, open: string, close: string, inner: boolean, count: number): Range | null {
  const onChar = pos.col < lines[pos.line].length;
  let o: Pos | null = onChar ? findOpen(lines, pos, open, close, true) : findOpen(lines, step(lines, pos, -1), open, close, false);
  for (let n = 1; n < count && o; n++) o = findOpen(lines, step(lines, o, -1), open, close, false);
  if (!o) return null;
  const c = findClose(lines, o, open, close);
  if (!c) return null;
  if (!inner) return { start: o, end: { line: c.line, col: c.col + 1 }, linewise: false };
  const openEndsLine = o.col === lines[o.line].length - 1;
  const closeStartsLine = lines[c.line].slice(0, c.col).trim() === "";
  if (openEndsLine && closeStartsLine && c.line - o.line >= 2) {
    return { start: { line: o.line + 1, col: 0 }, end: { line: c.line - 1, col: 0 }, linewise: true };
  }
  let start = { line: o.line, col: o.col + 1 };
  // Content starting on the next line: don't take the opener's line break.
  if (openEndsLine && c.line > o.line) start = { line: o.line + 1, col: 0 };
  let end = c;
  if (closeStartsLine && c.line > start.line) end = { line: c.line - 1, col: lines[c.line - 1].length };
  return { start, end, linewise: false };
}

// i" a" and friends, on the current line only. Quotes pair up from the start
// of the line, skipping backslash-escaped ones. Before the first quoted
// string, the next one is used.
function quote(lines: string[], pos: Pos, q: string, inner: boolean): Range | null {
  const line = lines[pos.line];
  const qs: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== q) continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 0) qs.push(i);
  }
  let open = -1;
  let close = -1;
  const k = qs.indexOf(pos.col);
  if (k >= 0) {
    [open, close] = k % 2 === 0 ? [qs[k], qs[k + 1]] : [qs[k - 1], qs[k]];
  } else {
    for (let i = 0; i + 1 < qs.length; i += 2) {
      if (qs[i] < pos.col && pos.col < qs[i + 1]) [open, close] = [qs[i], qs[i + 1]];
    }
    if (open < 0) {
      const j = qs.findIndex((x) => x > pos.col);
      if (j >= 0) [open, close] = [qs[j], qs[j + 1]];
    }
  }
  if (open < 0 || close === undefined || close < 0) return null;
  let start = inner ? open + 1 : open;
  let end = inner ? close : close + 1;
  if (!inner) {
    const trailing = /^\s*/u.exec(line.slice(end))![0].length;
    if (trailing > 0) end += trailing;
    else start -= /\s*$/u.exec(line.slice(0, start))![0].length;
  }
  return { start: { line: pos.line, col: start }, end: { line: pos.line, col: end }, linewise: false };
}

// ip: the block of lines around the cursor that are all blank or all not.
// ap: that plus the blank lines after it, or before it if there are none.
function paragraphObject(lines: string[], pos: Pos, inner: boolean, count: number): Range {
  const blank = (l: number) => lines[l].trim() === "";
  const blockEnd = (l: number) => {
    const b = blank(l);
    while (l + 1 < lines.length && blank(l + 1) === b) l++;
    return l;
  };
  let start = pos.line;
  while (start > 0 && blank(start - 1) === blank(pos.line)) start--;
  let end = blockEnd(pos.line);
  for (let n = 1; n < (inner ? count : 2 * count); n++) {
    if (end + 1 >= lines.length) break;
    end = blockEnd(end + 1);
  }
  if (!inner && !blank(pos.line) && !blank(end)) {
    // No blank lines after the paragraph: take the ones before it.
    while (start > 0 && blank(start - 1)) start--;
  }
  return { start: { line: start, col: 0 }, end: { line: end, col: 0 }, linewise: true };
}

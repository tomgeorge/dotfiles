// Character classes and grapheme stepping. Columns are UTF-16 offsets, as in
// the Pi editor's state; stepping by grapheme keeps the cursor off the middle
// of an emoji or combining sequence.

export type Pos = { line: number; col: number };

// Text an operator acts on. Charwise: end is exclusive. Linewise: every line
// from start.line to end.line; the columns don't matter.
export type Range = { start: Pos; end: Pos; linewise: boolean };

export const before = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.col < b.col);

// Vim's classes for `w`: blank, punctuation (other non-blank), word.
export const BLANK = 0;
export const PUNCT = 1;
export const WORD = 2;
export type CharClass = typeof BLANK | typeof PUNCT | typeof WORD;

const wordChar = /^[\p{L}\p{N}\p{M}_]/u;

// big: WORD motions (W B E), which only tell blank from non-blank.
export function charClass(ch: string, big = false): CharClass {
  if (ch === "" || /^\s/u.test(ch)) return BLANK;
  if (big) return WORD;
  return wordChar.test(ch) ? WORD : PUNCT;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Start offsets of each grapheme in line.
export function graphemeStarts(line: string): number[] {
  const starts: number[] = [];
  for (const { index } of segmenter.segment(line)) starts.push(index);
  return starts;
}

// Offset of the grapheme after the one at col, or line.length.
export function nextCol(line: string, col: number): number {
  for (const start of graphemeStarts(line)) if (start > col) return start;
  return line.length;
}

// Offset of the grapheme before col, or 0.
export function prevCol(line: string, col: number): number {
  let prev = 0;
  for (const start of graphemeStarts(line)) {
    if (start >= col) break;
    prev = start;
  }
  return prev;
}

// Start of the last grapheme: the rightmost column NORMAL mode allows.
export function lastCol(line: string): number {
  return line.length === 0 ? 0 : prevCol(line, line.length);
}

// Snap col to the start of the grapheme containing it.
export function snapCol(line: string, col: number): number {
  let snapped = 0;
  for (const start of graphemeStarts(line)) {
    if (start > col) break;
    snapped = start;
  }
  return snapped;
}

export function firstNonBlank(line: string): number {
  const m = /\S/u.exec(line);
  return m ? m.index : lastCol(line);
}

import type { Pos } from "./chars.ts";

// "one\n|two" -> lines and the cursor at the "|".
export function parse(text: string): { lines: string[]; pos: Pos } {
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const col = lines[line].indexOf("|");
    if (col >= 0) {
      lines[line] = lines[line].slice(0, col) + lines[line].slice(col + 1);
      return { lines, pos: { line, col } };
    }
  }
  throw new Error(`no cursor in ${JSON.stringify(text)}`);
}

export function show(lines: string[], pos: Pos): string {
  return lines.map((l, i) => (i === pos.line ? l.slice(0, pos.col) + "|" + l.slice(pos.col) : l)).join("\n");
}

// Runs NORMAL-mode commands. Pure: it takes the buffer and cursor and returns
// what should happen, which editor.ts applies to Pi's editor. Tests drive it
// with key strings.

import { charClass, BLANK, firstNonBlank, lastCol, nextCol, snapCol, type Pos, type Range } from "./chars.ts";
import { Parser, type Command, type MotionSpec, type Operator } from "./keys.ts";
import * as m from "./motions.ts";
import * as op from "./operators.ts";
import { textObject } from "./textobjects.ts";

export type Action =
  | { type: "none" }
  | { type: "pending" }
  | { type: "move"; cursor: Pos }
  | { type: "edit"; lines: string[]; cursor: Pos; insert: boolean }
  | { type: "insert"; cursor: Pos }
  | { type: "undo"; count: number }
  | { type: "redo"; count: number };

const NONE: Action = { type: "none" };

// NORMAL's cursor sits on a character, never past the last one.
export function clampNormal(lines: string[], pos: Pos): Pos {
  const line = Math.max(0, Math.min(lines.length - 1, pos.line));
  const text = lines[line] ?? "";
  return { line, col: Math.min(snapCol(text, pos.col), lastCol(text)) };
}

export class Engine {
  private parser = new Parser();
  register: op.Register | null = null;
  private lastFind: m.Find | null = null;
  // Sticky column for j/k; Infinity after $.
  private want: number | null = null;

  get pending(): string {
    return this.parser.pending;
  }

  // Esc: drop a half-typed command. True if there was one.
  cancel(): boolean {
    const had = this.parser.pending !== "";
    this.parser.reset();
    return had;
  }

  // The cursor moved some other way (arrows, INSERT): forget the column.
  forgetColumn(): void {
    this.want = null;
  }

  key(key: string, lines: string[], cursor: Pos): Action {
    const fed = this.parser.feed(key);
    if (!fed.done) return { type: "pending" };
    if (!fed.command) return NONE;
    return this.run(fed.command, lines, cursor);
  }

  private run(cmd: Command, lines: string[], pos: Pos): Action {
    switch (cmd.type) {
      case "motion":
        return this.move(cmd.motion, cmd.count, lines, pos);
      case "operator":
        return this.operate(cmd.op, cmd.register, cmd.count, cmd.target, lines, pos);
      case "simple":
        this.want = null;
        return this.simple(cmd.key, cmd.count, cmd.register, cmd.arg, lines, pos);
    }
  }

  private move(spec: MotionSpec, count: number | null, lines: string[], pos: Pos): Action {
    if (spec.key === "j" || spec.key === "k") {
      this.want ??= pos.col;
      const motion = m.vertical(lines, pos, (spec.key === "j" ? 1 : -1) * (count ?? 1), this.want);
      return motion ? { type: "move", cursor: motion.to } : NONE;
    }
    const motion = this.motion(spec, count, lines, pos, false);
    if (!motion) return NONE;
    this.want = spec.key === "$" ? Infinity : null;
    return { type: "move", cursor: clampNormal(lines, motion.to) };
  }

  private motion(spec: MotionSpec, count: number | null, lines: string[], pos: Pos, forOperator: boolean): m.Motion | null {
    const n = count ?? 1;
    switch (spec.key) {
      case "h": return m.left(lines, pos, n);
      case "l": return m.right(lines, pos, n, forOperator);
      case "j": return m.vertical(lines, pos, n, pos.col);
      case "k": return m.vertical(lines, pos, -n, pos.col);
      case "0": return m.lineStart(lines, pos);
      case "^": return m.firstNonBlankMotion(lines, pos);
      case "$": return m.lineEnd(lines, pos, n);
      case "w":
      case "W":
        return (forOperator ? m.wordForwardOp : m.wordForward)(lines, pos, n, spec.key === "W");
      case "b":
      case "B":
        return m.wordBackward(lines, pos, n, spec.key === "B");
      case "e":
      case "E":
        return m.wordEnd(lines, pos, n, spec.key === "E");
      case "ge":
      case "gE":
        return m.wordEndBackward(lines, pos, n, spec.key === "gE");
      case "G": return m.gotoLine(lines, count ?? lines.length);
      case "gg": return m.gotoLine(lines, count ?? 1);
      case "f":
      case "F":
      case "t":
      case "T":
        this.lastFind = { key: spec.key, char: spec.arg! };
        return m.findChar(lines, pos, this.lastFind, n);
      case ";":
        return this.lastFind && m.findChar(lines, pos, this.lastFind, n, true);
      case ",":
        return this.lastFind && m.findChar(lines, pos, m.reverseFind(this.lastFind), n, true);
      case "%": return m.matchPair(lines, pos);
      case "{": return m.paragraph(lines, pos, n, false);
      case "}": return m.paragraph(lines, pos, n, true);
    }
    return null;
  }

  private operate(
    opKey: Operator,
    register: string | null,
    count: number | null,
    target: { motion: MotionSpec } | { object: { key: string; inner: boolean } } | { line: true },
    lines: string[],
    pos: Pos,
  ): Action {
    this.want = null;
    let range: Range | null;
    if ("line" in target) {
      range = op.lineRange(lines, pos, count ?? 1);
    } else if ("object" in target) {
      range = textObject(lines, pos, target.object.key, target.object.inner, count ?? 1);
    } else {
      const spec = target.motion;
      const text = lines[pos.line];
      const onWord = pos.col < text.length && charClass(text.slice(pos.col, nextCol(text, pos.col))) !== BLANK;
      const motion = opKey === "c" && (spec.key === "w" || spec.key === "W") && onWord
        ? m.changeWordEnd(lines, pos, count ?? 1, spec.key === "W")
        : this.motion(spec, count, lines, pos, true);
      range = motion && op.motionRange(lines, pos, motion);
    }
    if (!range) return NONE;
    const empty = !range.linewise && range.start.line === range.end.line && range.start.col === range.end.col;
    if (empty) return opKey === "c" ? { type: "insert", cursor: range.start } : NONE;

    const result = op.operate(opKey, lines, range, pos);
    if (register !== "_") this.register = result.register;
    if (opKey === "y") return { type: "move", cursor: clampNormal(lines, result.cursor) };
    const cursor = result.insert ? result.cursor : clampNormal(result.lines, result.cursor);
    return { type: "edit", lines: result.lines, cursor, insert: result.insert };
  }

  private edit(e: op.Edit | null, insert = false): Action {
    if (!e) return NONE;
    return { type: "edit", lines: e.lines, cursor: insert ? e.cursor : clampNormal(e.lines, e.cursor), insert };
  }

  private simple(key: string, count: number | null, register: string | null, arg: string | undefined, lines: string[], pos: Pos): Action {
    const n = count ?? 1;
    const text = lines[pos.line];
    const motion = (k: string) => ({ motion: { key: k } });
    switch (key) {
      case "x": return this.operate("d", register, count, motion("l"), lines, pos);
      case "X": return this.operate("d", register, count, motion("h"), lines, pos);
      case "D": return this.operate("d", register, count, motion("$"), lines, pos);
      case "Y": return this.operate("y", register, count, { line: true }, lines, pos);
      case "S": return this.operate("c", register, count, { line: true }, lines, pos);
      case "C":
      case "s": {
        const action = this.operate("c", register, count, motion(key === "C" ? "$" : "l"), lines, pos);
        // Nothing to change (an empty line): still start typing.
        return action.type === "none" ? { type: "insert", cursor: pos } : action;
      }
      case "p":
      case "P":
        return this.register ? this.edit(op.put(lines, pos, this.register, key === "p", n)) : NONE;
      case "J": return this.edit(op.joinLines(lines, pos, n));
      case "~": return this.edit(op.toggleCase(lines, pos, n));
      case "r": return this.edit(op.replaceChars(lines, pos, arg!, n));
      case "u": return { type: "undo", count: n };
      case "<C-r>": return { type: "redo", count: n };
      case "i": return { type: "insert", cursor: pos };
      case "a": return { type: "insert", cursor: { line: pos.line, col: nextCol(text, pos.col) } };
      case "I": return { type: "insert", cursor: { line: pos.line, col: firstNonBlank(text) } };
      case "A": return { type: "insert", cursor: { line: pos.line, col: text.length } };
      case "o":
      case "O":
        return this.edit(op.openLine(lines, pos, key === "o"), true);
    }
    return NONE;
  }
}

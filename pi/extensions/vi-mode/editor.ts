// ViEditor: modes and key routing. Motions and edits are pure (motions.ts,
// operators.ts) and reach the editor state through the bridge.

import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { Bridge, missingInternals } from "./bridge.ts";
import { lastCol, nextCol, prevCol, snapCol, type Pos } from "./chars.ts";
import * as m from "./motions.ts";
import * as op from "./operators.ts";

type Mode = "insert" | "normal";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

// The key as typed text, if it's a single printable character. Covers legacy
// input and the kitty keyboard protocol's CSI-u encoding.
function printable(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  const chars = [...data];
  if (chars.length !== 1) return undefined;
  const code = data.codePointAt(0)!;
  return code >= 32 && code !== 127 ? data : undefined;
}

export class ViEditor extends CustomEditor {
  // Non-empty when this Pi's editor lacks fields the bridge needs; the editor
  // then behaves exactly like the default one.
  readonly missing: string[];
  private bridge: Bridge;
  private mode: Mode = "insert";
  private pending = "";
  // Sticky column for j/k; Infinity after $. Reset by horizontal moves.
  private want: number | null = null;
  // Bracketed paste can arrive over several reads; none of it is a command.
  private pasting = false;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
    this.missing = missingInternals(this);
    this.bridge = new Bridge(this);
  }

  handleInput(data: string): void {
    if (this.missing.length > 0 || this.trackPaste(data)) {
      super.handleInput(data);
      return;
    }
    if (this.mode === "insert") this.insertKey(data);
    else this.normalKey(data);
  }

  // True while data is part of a bracketed paste.
  private trackPaste(data: string): boolean {
    if (data.includes(PASTE_START)) this.pasting = true;
    if (!this.pasting) return false;
    if (data.includes(PASTE_END)) this.pasting = false;
    return true;
  }

  private insertKey(data: string): void {
    if (matchesKey(data, "escape") && !this.isShowingAutocomplete()) {
      this.mode = "normal";
      const { line, col } = this.bridge.cursor();
      this.move({ line, col: prevCol(this.bridge.lines()[line], col) });
      return;
    }
    super.handleInput(data);
  }

  private normalKey(data: string): void {
    if (matchesKey(data, "escape")) {
      if (this.pending) this.pending = "";
      else super.handleInput(data); // abort, as in the default editor
      return;
    }
    if (matchesKey(data, "enter")) {
      this.pending = "";
      super.handleInput(data);
      // Submitted: the next prompt starts out typing.
      if (this.getText() === "") this.mode = "insert";
      else this.clamp();
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.command("h");
      return;
    }
    const key = printable(data);
    if (key === undefined) {
      // ctrl chords, arrows, and so on keep their Pi meaning.
      this.pending = "";
      this.want = null;
      super.handleInput(data);
      this.clamp();
      return;
    }
    this.command(key);
  }

  private command(key: string): void {
    const lines = this.bridge.lines();
    const pos = this.bridge.cursor();

    if (this.pending) {
      const pending = this.pending;
      this.pending = "";
      if (pending === "d" && key === "d") this.edit(op.deleteLines(lines, pos));
      if (pending === "c" && key === "c") this.edit(op.changeLine(lines, pos), "insert");
      return;
    }

    // j/k keep the sticky column; $ sets it to the line end.
    if (key === "j" || key === "k") {
      this.want ??= pos.col;
      this.bridge.setCursor(m.vertical(lines, pos, key === "j" ? 1 : -1, this.want).to);
      return;
    }
    if (key === "$") {
      this.bridge.setCursor(m.lineEnd(lines, pos).to);
      this.want = Infinity;
      return;
    }
    const motion = this.motion(key, lines, pos);
    if (motion) {
      this.move(motion.to);
      return;
    }
    this.want = null;

    switch (key) {
      case "i":
        return this.insertAt(pos);
      case "a":
        return this.insertAt({ line: pos.line, col: nextCol(lines[pos.line], pos.col) });
      case "I":
        return this.insertAt(m.firstNonBlankMotion(lines, pos).to);
      case "A":
        return this.insertAt({ line: pos.line, col: lines[pos.line].length });
      case "o":
      case "O":
        return this.edit(op.openLine(lines, pos, key === "o"), "insert");
      case "x":
        return this.edit(op.deleteChars(lines, pos));
      case "D":
        return this.edit(op.deleteToEnd(lines, pos));
      case "C":
        return this.edit(op.deleteToEnd(lines, pos, true), "insert");
      case "d":
      case "c":
        this.pending = key;
        return;
      case "u":
        this.bridge.undo();
        this.clamp();
        return;
    }
    // Unmapped keys do nothing: NORMAL mode never inserts text.
  }

  private motion(key: string, lines: string[], pos: Pos): m.Motion | null {
    switch (key) {
      case "h": return m.left(lines, pos);
      case "l": return m.right(lines, pos);
      case "0": return m.lineStart(lines, pos);
      case "^": return m.firstNonBlankMotion(lines, pos);
      case "w": return m.wordForward(lines, pos);
      case "W": return m.wordForward(lines, pos, 1, true);
      case "b": return m.wordBackward(lines, pos);
      case "B": return m.wordBackward(lines, pos, 1, true);
      case "e": return m.wordEnd(lines, pos);
      case "E": return m.wordEnd(lines, pos, 1, true);
    }
    return null;
  }

  private move(pos: Pos): void {
    this.want = null;
    this.bridge.setCursor(pos);
  }

  private insertAt(pos: Pos): void {
    this.bridge.setCursor(pos);
    this.mode = "insert";
  }

  // A null edit (nothing to delete) adds no undo step, but C on an empty
  // line still enters INSERT.
  private edit(e: op.Edit | null, mode: Mode = this.mode): void {
    if (e) this.bridge.applyEdit(e.lines, e.cursor);
    this.mode = mode;
    this.clamp();
  }

  // NORMAL's cursor sits on a character, never past the last one.
  private clamp(): void {
    if (this.mode !== "normal") return;
    const { line, col } = this.bridge.cursor();
    const text = this.bridge.lines()[line] ?? "";
    const clamped = Math.min(snapCol(text, col), lastCol(text));
    if (clamped !== col) this.bridge.setCursor({ line, col: clamped });
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    if (this.missing.length > 0) return super.renderBottomBorder(width, hiddenLineCount);
    const label = ` ${this.pending || (this.mode === "normal" ? "NORMAL" : "INSERT")} `;
    const labelWidth = visibleWidth(label);
    if (width < labelWidth + 4) return super.renderBottomBorder(width, hiddenLineCount);
    return super.renderBottomBorder(width - labelWidth - 1, hiddenLineCount) + this.borderColor(label + "─");
  }
}

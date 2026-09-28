// ViEditor: modes, key routing, undo and redo. NORMAL-mode commands run in
// engine.ts, which is pure; this file applies what it returns through the
// bridge.

import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { Bridge, missingInternals, type Snapshot } from "./bridge.ts";
import { prevCol } from "./chars.ts";
import { clampNormal, Engine, type Action } from "./engine.ts";

type Mode = "insert" | "normal";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

// The key as typed text, if it's a single printable character. Covers legacy
// input and the kitty keyboard protocol's CSI-u encoding.
function printable(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  if ([...data].length !== 1) return undefined;
  const code = data.codePointAt(0)!;
  return code >= 32 && code !== 127 ? data : undefined;
}

export class ViEditor extends CustomEditor {
  // Non-empty when this Pi's editor lacks fields the bridge needs; the editor
  // then behaves exactly like the default one.
  readonly missing: string[];
  private bridge: Bridge;
  private engine = new Engine();
  private mode: Mode = "insert";
  // Undo depth when INSERT began; Esc squashes everything since into one step.
  private insertDepth = 0;
  // Redo, which the base editor lacks. Valid only while the text is what the
  // last undo or redo left, so typing in between invalidates it.
  private redoStack: Snapshot[] = [];
  private redoText: string | null = null;
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

  private enterInsert(): void {
    this.mode = "insert";
    this.insertDepth = this.bridge.undoDepth();
    this.engine.forgetColumn();
  }

  private insertKey(data: string): void {
    if (matchesKey(data, "escape") && !this.isShowingAutocomplete()) {
      this.mode = "normal";
      this.bridge.squashUndoTo(this.insertDepth);
      const { line, col } = this.bridge.cursor();
      this.bridge.setCursor({ line, col: prevCol(this.bridge.lines()[line], col) });
      return;
    }
    super.handleInput(data);
    // Submitting clears the undo stack; the next session starts from there.
    if (matchesKey(data, "enter") && this.getText() === "") this.insertDepth = this.bridge.undoDepth();
  }

  private normalKey(data: string): void {
    if (matchesKey(data, "escape")) {
      // Esc cancels a half-typed command; otherwise it's Pi's (abort).
      if (!this.engine.cancel()) super.handleInput(data);
      return;
    }
    if (matchesKey(data, "enter")) {
      this.engine.cancel();
      super.handleInput(data);
      // Submitted: the next prompt starts out typing.
      if (this.getText() === "") this.enterInsert();
      else this.clamp();
      return;
    }
    const key = matchesKey(data, "ctrl+r") ? "<C-r>" : matchesKey(data, "backspace") ? "h" : printable(data);
    if (key === undefined) {
      // ctrl chords, arrows, and so on keep their Pi meaning.
      this.engine.cancel();
      this.engine.forgetColumn();
      super.handleInput(data);
      this.clamp();
      return;
    }
    this.apply(this.engine.key(key, this.bridge.lines(), this.bridge.cursor()));
  }

  private apply(action: Action): void {
    switch (action.type) {
      case "move":
        this.bridge.setCursor(action.cursor);
        return;
      case "edit":
        this.redoStack = [];
        if (action.insert) this.enterInsert();
        this.bridge.applyEdit(action.lines, action.cursor);
        return;
      case "insert":
        this.enterInsert();
        this.bridge.setCursor(action.cursor);
        return;
      case "undo":
        for (let i = 0; i < action.count && this.bridge.undoDepth() > 0; i++) {
          this.redoStack.push(this.bridge.snapshot());
          this.bridge.undo();
        }
        this.redoText = this.getText();
        this.clamp();
        return;
      case "redo":
        if (this.getText() !== this.redoText) this.redoStack = [];
        for (let i = 0; i < action.count && this.redoStack.length > 0; i++) this.bridge.restore(this.redoStack.pop()!);
        this.redoText = this.getText();
        this.clamp();
        return;
    }
  }

  private clamp(): void {
    if (this.mode !== "normal") return;
    const pos = this.bridge.cursor();
    const clamped = clampNormal(this.bridge.lines(), pos);
    if (clamped.line !== pos.line || clamped.col !== pos.col) this.bridge.setCursor(clamped);
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    if (this.missing.length > 0) return super.renderBottomBorder(width, hiddenLineCount);
    const label = ` ${this.engine.pending || (this.mode === "normal" ? "NORMAL" : "INSERT")} `;
    const labelWidth = visibleWidth(label);
    if (width < labelWidth + 4) return super.renderBottomBorder(width, hiddenLineCount);
    return this.borderColor("─" + label) + super.renderBottomBorder(width - labelWidth - 1, hiddenLineCount);
  }
}

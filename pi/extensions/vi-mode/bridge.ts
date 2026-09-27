// The only file that reaches into the Pi editor's private fields. Editor has
// no public way to move the cursor or replace text without side effects:
// setText() drops collapsed paste markers' content, and replaying arrow keys
// moves by wrapped rows and opens history. Checked against Pi 0.87.1.

import type { Pos } from "./chars.ts";

type Internals = {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  undoStack: { stack: unknown[] };
  lastAction: unknown;
  setCursorCol(col: number): void;
  pushUndoSnapshot(): void;
  undo(): void;
  exitHistoryBrowsing(): void;
  getText(): string;
  onChange?: (text: string) => void;
};

// Returns what's missing, or [] if editor has every field the bridge needs.
export function missingInternals(editor: object): string[] {
  const e = editor as Partial<Internals>;
  const missing: string[] = [];
  const s = e.state;
  if (!s || !Array.isArray(s.lines) || typeof s.cursorLine !== "number" || typeof s.cursorCol !== "number") missing.push("state");
  if (!Array.isArray(e.undoStack?.stack)) missing.push("undoStack.stack");
  if (!("lastAction" in e)) missing.push("lastAction");
  for (const fn of ["setCursorCol", "pushUndoSnapshot", "undo", "exitHistoryBrowsing"] as const) {
    if (typeof e[fn] !== "function") missing.push(fn);
  }
  return missing;
}

export class Bridge {
  private e: Internals;

  constructor(editor: object) {
    this.e = editor as Internals;
  }

  lines(): string[] {
    return this.e.state.lines;
  }

  cursor(): Pos {
    return { line: this.e.state.cursorLine, col: this.e.state.cursorCol };
  }

  setCursor(pos: Pos): void {
    this.e.state.cursorLine = pos.line;
    this.e.setCursorCol(pos.col);
    // The base editor merges consecutive typing into one undo step via
    // lastAction; a jump should start a new one.
    this.e.lastAction = null;
  }

  // One undo step. Keeps pastes, so collapsed paste markers still expand.
  applyEdit(lines: string[], cursor: Pos): void {
    this.e.exitHistoryBrowsing();
    this.e.pushUndoSnapshot();
    this.e.state.lines = lines;
    this.setCursor(cursor);
    this.e.onChange?.(this.e.getText());
  }

  undo(): void {
    this.e.undo();
  }
}

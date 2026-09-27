// The only file that reaches into the Pi editor's private fields. Editor has
// no public way to move the cursor or replace text without side effects:
// setText() drops collapsed paste markers' content, and replaying arrow keys
// moves by wrapped rows and opens history. Checked against Pi 0.87.1.

import type { Pos } from "./chars.ts";

type Internals = {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  undoStack: { stack: unknown[] };
  lastAction: unknown;
  pastes: Map<number, string>;
  pasteCounter: number;
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
  if (!(e.pastes instanceof Map)) missing.push("pastes");
  if (typeof e.pasteCounter !== "number") missing.push("pasteCounter");
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

  undoDepth(): number {
    return this.e.undoStack.stack.length;
  }

  // Drop snapshots after the first depth + 1, so everything since depth
  // undoes as one step (an insert session).
  squashUndoTo(depth: number): void {
    const stack = this.e.undoStack.stack;
    if (stack.length > depth + 1) stack.length = depth + 1;
  }

  // For redo, which the base editor doesn't have. Includes pastes, so a
  // redone paste marker still expands.
  snapshot(): Snapshot {
    return {
      lines: [...this.e.state.lines],
      cursor: this.cursor(),
      pastes: new Map(this.e.pastes),
      pasteCounter: this.e.pasteCounter,
    };
  }

  // Restore a snapshot as a new undo step.
  restore(s: Snapshot): void {
    this.e.exitHistoryBrowsing();
    this.e.pushUndoSnapshot();
    this.e.pastes = new Map(s.pastes);
    this.e.pasteCounter = s.pasteCounter;
    this.e.state.lines = [...s.lines];
    this.setCursor(s.cursor);
    this.e.onChange?.(this.e.getText());
  }
}

export type Snapshot = { lines: string[]; cursor: Pos; pastes: Map<number, string>; pasteCounter: number };

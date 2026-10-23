// ViEditor: modes, key routing, undo and redo, and the leader. NORMAL-mode
// commands run in engine.ts and leader steps in leader.ts, both pure; this
// file applies what they return.

import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { Bridge, missingInternals, type Snapshot } from "./bridge.ts";
import { prevCol } from "./chars.ts";
import { PI_BUILTIN_COMMANDS } from "./coreBindings.ts";
import { clampNormal, Engine, type Action } from "./engine.ts";
import { leaderKey, opensLeader, type LeaderStep } from "./leader.ts";
import type { LeaderRegistry, LeaderTarget } from "./leaderRegistry.ts";
import { whichKeyLines, type WhichKeyStyle } from "./whichKey.ts";

type Mode = "insert" | "normal";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
// How long the border shows a leader path that matched nothing.
const MISSED_MS = 1500;
// Stands in for a key that's neither printable nor Esc or Backspace (an arrow,
// a chord). leaderKey closes on any input longer than one character.
const OTHER_KEY = "other";

// What the editor needs from index.ts to run the leader.
export interface LeaderOptions {
  registry: Pick<LeaderRegistry, "group" | "subscribe">;
  // The leader key as the terminal sends it, and how paths show it ("SPC").
  key: string;
  name: string;
  style: WhichKeyStyle;
  // The which-key panel's lines, or undefined to remove it.
  showPanel(lines: string[] | undefined): void;
  commandExists(name: string): boolean;
  notify(text: string, level: "info" | "warning" | "error"): void;
}

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
  private readonly leader: LeaderOptions;
  // The keys pressed since the leader key; undefined while the leader is closed.
  private leaderPath: string[] | undefined;
  private unsubscribeLeader: (() => void) | undefined;
  // A path that matched nothing, shown in the border for MISSED_MS.
  private missed: string[] | undefined;
  private missedTimer: ReturnType<typeof setTimeout> | undefined;
  // A paste that arrived while the leader was open, being thrown away.
  private droppingPaste = false;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, leader: LeaderOptions) {
    super(tui, theme, keybindings);
    this.missing = missingInternals(this);
    this.bridge = new Bridge(this);
    this.leader = leader;
  }

  handleInput(data: string): void {
    // An open leader takes every key, Esc included, so nothing reaches Pi
    // (whose Esc aborts the turn). It only opens when the bridge works.
    if (this.leaderPath) {
      this.leaderInput(data, this.leaderPath);
      return;
    }
    if (this.dropPaste(data)) return;
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

  // True while data is the rest of a paste that began with the leader open.
  private dropPaste(data: string): boolean {
    if (!this.droppingPaste) return false;
    if (data.includes(PASTE_END)) this.droppingPaste = false;
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
    if (key !== undefined && opensLeader({ mode: this.mode, pending: this.engine.pending, key, leaderKey: this.leader.key })) {
      this.openLeader();
      return;
    }
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

  private openLeader(): void {
    this.clearMissed();
    this.leaderPath = [];
    // Contributions can arrive while the leader is open; redraw with them.
    this.unsubscribeLeader = this.leader.registry.subscribe(() => this.drawLeader());
    this.drawLeader();
  }

  private closeLeader(): void {
    if (!this.leaderPath) return;
    this.leaderPath = undefined;
    this.unsubscribeLeader?.();
    this.unsubscribeLeader = undefined;
    this.leader.showPanel(undefined);
  }

  private drawLeader(): void {
    const path = this.leaderPath;
    if (!path) return;
    const group = this.leader.registry.group(path);
    // The tree changed under the open leader and this group is gone.
    if (!group) {
      this.closeLeader();
      return;
    }
    this.leader.showPanel(whichKeyLines(group, path, this.leader.name, this.tui.terminal.columns, this.leader.style));
  }

  private leaderInput(data: string, path: string[]): void {
    if (data.includes(PASTE_START)) {
      // A paste isn't a leader key. Close, and drop the paste whole rather
      // than type the reads that follow this one.
      this.droppingPaste = !data.includes(PASTE_END);
      this.closeLeader();
      return;
    }
    const input = matchesKey(data, "escape") ? "escape" : matchesKey(data, "backspace") ? "backspace" : (printable(data) ?? OTHER_KEY);
    this.stepLeader(leaderKey(this.leader.registry, path, input));
  }

  private stepLeader(step: LeaderStep): void {
    switch (step.type) {
      case "descend":
        this.leaderPath = step.path;
        this.drawLeader();
        return;
      case "close":
        this.closeLeader();
        if (step.missed) this.showMissed(step.missed);
        return;
      case "run":
        // Close first, so the panel is gone before whatever the binding opens.
        this.closeLeader();
        this.runLeader(step.target);
        return;
    }
  }

  private runLeader(target: LeaderTarget): void {
    if ("app" in target) {
      // Looked up now, not in the constructor: Pi copies its handlers in after
      // the editor factory returns.
      const handlers: ReadonlyMap<string, () => void> = this.actionHandlers;
      const handler = handlers.get(target.app);
      if (handler) handler();
      else this.leader.notify(`Leader: this Pi has no action ${target.app}`, "warning");
      return;
    }
    const { name, args } = target.command;
    if (!PI_BUILTIN_COMMANDS.has(name) && !this.leader.commandExists(name)) {
      this.leader.notify(`Leader: no command /${name}`, "warning");
      return;
    }
    // Submit the command from an empty prompt, as though typed, then put the
    // draft back. Pi's onSubmit clears the editor before its first await, so
    // the draft restored here stays. The bridge puts back the cursor, the
    // collapsed pastes, and the undo stack, which setText(draft) would lose.
    const draft = this.bridge.snapshot();
    const depth = this.bridge.undoDepth();
    this.setText("");
    try {
      this.onSubmit?.(args ? `/${name} ${args}` : `/${name}`);
    } finally {
      this.bridge.reinstate(draft, depth);
    }
  }

  private showMissed(path: string[]): void {
    this.clearMissed();
    this.missed = path;
    this.missedTimer = setTimeout(() => {
      this.missed = undefined;
      this.missedTimer = undefined;
      this.tui.requestRender();
    }, MISSED_MS);
    // A border label mustn't keep the process alive.
    this.missedTimer.unref();
  }

  private clearMissed(): void {
    if (this.missedTimer) clearTimeout(this.missedTimer);
    this.missedTimer = undefined;
    this.missed = undefined;
  }

  private apply(action: Action): void {
    switch (action.type) {
      case "none":
      case "pending":
        return;
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
        this.undoSteps(action.count);
        return;
      case "redo":
        this.redoSteps(action.count);
        return;
    }
  }

  // Named apart from the base editor's private undo(), which must stay intact.
  private undoSteps(count: number): void {
    for (let i = 0; i < count && this.bridge.undoDepth() > 0; i++) {
      this.redoStack.push(this.bridge.snapshot());
      this.bridge.undo();
    }
    this.redoText = this.getText();
    this.clamp();
  }

  private redoSteps(count: number): void {
    if (this.getText() !== this.redoText) this.redoStack = [];
    for (let i = 0; i < count && this.redoStack.length > 0; i++) this.bridge.restore(this.redoStack.pop()!);
    this.redoText = this.getText();
    this.clamp();
  }

  private clamp(): void {
    if (this.mode !== "normal") return;
    const pos = this.bridge.cursor();
    const clamped = clampNormal(this.bridge.lines(), pos);
    if (clamped.line !== pos.line || clamped.col !== pos.col) this.bridge.setCursor(clamped);
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    if (this.missing.length > 0) return super.renderBottomBorder(width, hiddenLineCount);
    const label = ` ${this.borderLabel()} `;
    const labelWidth = visibleWidth(label);
    if (width < labelWidth + 4) return super.renderBottomBorder(width, hiddenLineCount);
    return this.borderColor("─" + label) + super.renderBottomBorder(width - labelWidth - 1, hiddenLineCount);
  }

  // The leader path while it's open; else a half-typed command, a path that
  // just missed, or the mode.
  private borderLabel(): string {
    if (this.leaderPath) return [this.leader.name, ...this.leaderPath].join(" ");
    if (this.engine.pending) return this.engine.pending;
    if (this.missed) return [this.leader.name, ...this.missed].join(" ");
    return this.mode === "normal" ? "NORMAL" : "INSERT";
  }
}

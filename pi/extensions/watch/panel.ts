import { count, exitText, outputText } from "./report.ts";
import { formatDuration, tail, type EndReason, type RunResult, type Watch } from "./watcher.ts";

// Session record of every watch, plus rendering for the below-editor widget and
// the /watches popup. Mirrors subagent/panel.ts; each extension is linked on its
// own, so the shared bits are copied rather than imported. Styling is injected
// (Pi's theme and pi-tui in production) so layout is testable without Pi.

export type Tone = "accent" | "muted" | "dim" | "success" | "error" | "warning" | "border" | "borderAccent" | "text";

export interface Style {
  fg(tone: Tone, text: string): string;
  bold(text: string): string;
  /** Highlight for the selected list row. */
  selected(text: string): string;
  width(text: string): number;
  /** Cut to `width` columns with an ellipsis; `pad` fills short text with spaces. */
  truncate(text: string, width: number, pad?: boolean): string;
  wrap(text: string, width: number): string[];
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const WIDGET_ROWS = 5;
export const LOG_LIMIT = 200;
/** Ended watches kept for the popup; the oldest go first. */
export const ENDED_LIMIT = 50;

// ── Store ────────────────────────────────────────────────────────────────

export interface LogEntry {
  /** Epoch ms of the latest occurrence. */
  at: number;
  text: string;
  tone?: Tone;
  /** Identical consecutive checks collapse into one entry. */
  repeat: number;
  /** Set on check entries, to detect repeats. */
  signature?: string;
}

export interface Ended { at: number; reason: EndReason; detail?: string }

export interface WatchRecord {
  /** Unique for the session; watch ids are reused once a watch ends. */
  key: number;
  /** Live object: the Registry mutates it until the watch ends. */
  watch: Watch;
  ended?: Ended;
  log: LogEntry[];
  /** The last check result already logged. */
  logged?: RunResult;
}

/** Expand tabs to 8-column stops: the width helpers count a tab as one column. */
function expandTabs(text: string): string {
  return text.split("\n").map((line) => {
    let out = "";
    for (const part of line.split("\t").entries()) {
      if (part[0] > 0) out += " ".repeat(8 - ([...out].length % 8));
      out += part[1];
    }
    return out;
  }).join("\n");
}

const outputLines = (result: RunResult) =>
  expandTabs(`${result.stdout}\n${result.stderr}`).split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);

/** The line worth showing for a check: the first one new since `previous`, else the last (where status usually is). */
function summaryLine(result: RunResult, previous: RunResult | undefined) {
  const lines = outputLines(result);
  if (previous) {
    const before = new Set(outputLines(previous));
    const fresh = lines.find((line) => !before.has(line));
    if (fresh) return fresh;
  }
  return lines.at(-1) ?? "";
}

export class WatchStore {
  private records: WatchRecord[] = [];
  private byWatch = new Map<Watch, WatchRecord>();
  private nextKey = 1;
  private listeners = new Set<() => void>();

  add(watch: Watch, now = Date.now()): WatchRecord {
    const record: WatchRecord = { key: this.nextKey++, watch, log: [] };
    this.records.push(record);
    this.byWatch.set(watch, record);
    this.push(record, { at: now, text: "started", tone: "dim", repeat: 1 });
    // A command's first check may have finished before the record existed.
    this.sync(watch, now);
    return record;
  }

  /** Log a finished check that isn't logged yet. Safe to call on every registry event. */
  sync(watch: Watch, now = Date.now()) {
    const record = this.byWatch.get(watch);
    if (!record) return;
    const last = watch.last;
    if (last && last !== record.logged) {
      const line = summaryLine(last, record.logged);
      record.logged = last;
      // Whole output, as the Registry compares for `change`: the shown line alone can hide a change.
      const signature = `${exitText(last)}\n${last.stdout.trim()}\n${last.stderr.trim()}`;
      const text = `check · ${exitText(last)}${line ? ` · ${line}` : ""}`;
      const tone: Tone | undefined = last.code === 0 && !last.killed ? undefined : "dim";
      const prev = record.log.at(-1);
      if (prev?.signature === signature) {
        prev.repeat++;
        prev.at = now;
      } else this.push(record, { at: now, text, tone, repeat: 1, signature });
    }
    this.emit();
  }

  note(watch: Watch, text: string, tone?: Tone, now = Date.now()) {
    const record = this.byWatch.get(watch);
    if (!record) return;
    this.push(record, { at: now, text, tone, repeat: 1 });
    this.emit();
  }

  end(watch: Watch, reason: EndReason, detail?: string, now = Date.now()) {
    const record = this.byWatch.get(watch);
    if (!record || record.ended) return;
    this.sync(watch, now);
    record.ended = { at: now, reason, detail };
    this.push(record, { at: now, text: endText(watch, record.ended), tone: END_MARK[reason].tone, repeat: 1 });
    const ended = this.records.filter((r) => r.ended);
    for (const old of ended.slice(0, Math.max(0, ended.length - ENDED_LIMIT))) {
      this.records.splice(this.records.indexOf(old), 1);
      this.byWatch.delete(old.watch);
    }
    this.emit();
  }

  list(): WatchRecord[] { return [...this.records]; }
  active(): WatchRecord[] { return this.records.filter((record) => !record.ended); }
  get(key: number) { return this.records.find((record) => record.key === key); }

  /** Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private push(record: WatchRecord, entry: LogEntry) {
    record.log.push(entry);
    if (record.log.length > LOG_LIMIT) record.log.splice(0, record.log.length - LOG_LIMIT);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

// ── Formatting ───────────────────────────────────────────────────────────

function duration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

const kindLabel = (watch: Watch) => watch.kind === "prompt" ? "loop" : "watch";

function endText(watch: Watch, ended: Ended): string {
  switch (ended.reason) {
    case "met": return "condition met";
    case "stopped": return "stopped";
    case "timeout": return `timed out after ${formatDuration(watch.timeoutMs)}`;
    case "error": return `error: ${ended.detail?.split("\n")[0] || "failed"}`;
  }
}

/** What the watch is doing now, or how it ended. */
function status(record: WatchRecord, now: number): string {
  const { watch } = record;
  if (record.ended) return endText(watch, record.ended);
  if (watch.state === "running") return "checking…";
  if (watch.state === "due") return "due when idle";
  return watch.nextAt ? `next in ${duration(watch.nextAt - now)}` : "waiting";
}

/** `3 checks` / `2 runs`. */
const counter = (watch: Watch) => watch.kind === "prompt" ? count(watch.fires, "run") : count(watch.checks, "check");

/** How an ended watch shows in the list and its log. */
const END_MARK: Record<EndReason, { tone: Tone; icon: string }> = {
  met: { tone: "success", icon: "✓" },
  error: { tone: "error", icon: "✗" },
  timeout: { tone: "warning", icon: "⊘" },
  stopped: { tone: "muted", icon: "⊘" },
};

function icon(record: WatchRecord, frame: number, s: Style) {
  if (record.ended) {
    const mark = END_MARK[record.ended.reason];
    return s.fg(mark.tone, mark.icon);
  }
  switch (record.watch.state) {
    case "running": return s.fg("accent", SPINNER[frame % SPINNER.length]);
    case "due": return s.fg("warning", "●");
    default: return s.fg("muted", "◷");
  }
}

/** True while any check runs: the caller animates the spinner faster then. */
export const anyChecking = (records: WatchRecord[]) => records.some((r) => !r.ended && r.watch.state === "running");

const padStart = (text: string, width: number, s: Style) => " ".repeat(Math.max(0, width - s.width(text))) + text;

/** A rule with a left title and optional right hint, e.g. `─ Watches ───── hint ─`. */
function rule(left: string, right: string, width: number, s: Style) {
  const head = `─ ${left} `;
  const tail = right ? ` ${right} ─` : "─";
  const fill = width - s.width(head) - s.width(tail);
  if (fill < 1) return s.truncate(s.fg("border", "─ ") + left, width);
  return s.fg("border", "─ ") + left + s.fg("border", ` ${"─".repeat(fill)}`) + (right ? ` ${s.fg("dim", right)} ${s.fg("border", "─")}` : s.fg("border", "─"));
}

function summary(records: WatchRecord[]) {
  const active = records.filter((r) => !r.ended);
  const loops = active.filter((r) => r.watch.kind === "prompt").length;
  const watches = active.length - loops;
  return [watches && `${watches} watching`, loops && count(loops, "loop")].filter(Boolean).join(" · ") || "none active";
}

// ── Widget ───────────────────────────────────────────────────────────────

/** Below-editor widget: active watches only, capped at WIDGET_ROWS. Empty when none are active. */
export function widgetLines(records: WatchRecord[], now: number, width: number, s: Style, opts: { frame: number; hint: string }): string[] {
  const active = records.filter((r) => !r.ended);
  if (!active.length) return [];
  const shown = active.length > WIDGET_ROWS ? active.slice(0, WIDGET_ROWS - 1) : active;
  const idW = Math.max(...shown.map((r) => `#${r.watch.id}`.length));
  const descW = Math.min(28, Math.max(...shown.map((r) => s.width(r.watch.description))));
  const countW = Math.max(...shown.map((r) => counter(r.watch).length));
  const lastW = Math.max(0, ...shown.map((r) => r.watch.last ? exitText(r.watch.last).length : 0));
  const lines = [rule(`${s.bold("Watches")} ${s.fg("muted", `· ${summary(records)}`)}`, opts.hint, width, s)];
  for (const record of shown) {
    const { watch } = record;
    const last = watch.last ? exitText(watch.last) : "";
    const cells = [
      ` ${icon(record, opts.frame, s)}`,
      s.fg("accent", `#${watch.id}`.padEnd(idW)),
      s.fg("muted", kindLabel(watch).padEnd(5)),
      s.truncate(watch.description, descW, true),
      s.fg("dim", padStart(counter(watch), countW, s)),
      ...(lastW ? [s.fg(watch.last && watch.last.code !== 0 ? "dim" : "success", last.padEnd(lastW))] : []),
      watch.state === "due" ? s.fg("warning", status(record, now)) : s.fg("dim", status(record, now)),
    ];
    lines.push(s.truncate(cells.join("  "), width));
  }
  if (shown.length < active.length) {
    lines.push(s.truncate(s.fg("dim", `   +${active.length - shown.length} more · ${opts.hint} to view all`), width));
  }
  return lines;
}

// ── Popup ────────────────────────────────────────────────────────────────

export type Focus = "list" | "detail";
export type BodyView = "activity" | "output";

export interface PopupState {
  /** Selected record key. */
  selected: number | undefined;
  focus: Focus;
  /** Body scroll offset in lines; "end" follows the tail. */
  scroll: number | "end";
  view: BodyView;
}

export type PopupKey =
  | "up" | "down" | "pageUp" | "pageDown" | "top" | "bottom"
  | "enter" | "back" | "toggle" | "stop" | "close";

export type PopupAction = { type: "none" } | { type: "close" } | { type: "stop"; watch: Watch };

export function initialPopup(records: WatchRecord[]): PopupState {
  // Newest active watch, else the newest one.
  const pick = [...records].reverse().find((r) => !r.ended) ?? records.at(-1);
  return { selected: pick?.key, focus: "list", scroll: "end", view: "activity" };
}

// The log reads bottom-up (newest last), so it opens at the tail; output reads from the top.
const resetScroll = (state: PopupState) => { state.scroll = state.view === "activity" ? "end" : 0; };

/** Apply a key. `page` is the body height, for paging. Mutates `state`. */
export function popupKey(state: PopupState, records: WatchRecord[], key: PopupKey, page: number): PopupAction {
  const index = records.findIndex((r) => r.key === state.selected);
  const record = records[index];
  if (key === "close") return { type: "close" };
  if (key === "stop") return record && !record.ended ? { type: "stop", watch: record.watch } : { type: "none" };
  if (key === "toggle" && record) {
    state.view = state.view === "activity" ? "output" : "activity";
    resetScroll(state);
    return { type: "none" };
  }
  if (state.focus === "list") {
    if (key === "back") return { type: "close" };
    if (key === "enter") { if (record) state.focus = "detail"; return { type: "none" }; }
    const last = records.length - 1;
    const target = key === "up" ? index - 1 : key === "down" ? index + 1
      : key === "top" ? 0 : key === "bottom" ? last
      : key === "pageUp" ? index - page : key === "pageDown" ? index + page : index;
    const next = records[Math.min(last, Math.max(0, target))];
    if (next && next.key !== state.selected) {
      state.selected = next.key;
      resetScroll(state);
    }
    return { type: "none" };
  }
  if (key === "back" || key === "enter") { state.focus = "list"; return { type: "none" }; }
  // Detail focus: scroll the body. "end" is resolved against content length at render.
  const current = state.scroll === "end" ? Number.MAX_SAFE_INTEGER : state.scroll;
  const deltas: Partial<Record<PopupKey, number>> = { up: -1, down: 1, pageUp: -page, pageDown: page };
  const delta = deltas[key];
  if (key === "top") state.scroll = 0;
  else if (key === "bottom") state.scroll = "end";
  else if (delta !== undefined) state.scroll = Math.max(0, current + delta);
  return { type: "none" };
}

function box(title: string, body: string[], width: number, height: number, focused: boolean, s: Style): string[] {
  const tone: Tone = focused ? "borderAccent" : "border";
  const inner = Math.max(1, width - 2);
  const head = s.truncate(` ${title} `, Math.max(0, inner - 1));
  const top = s.fg(tone, "┌─") + head + s.fg(tone, `${"─".repeat(Math.max(0, inner - 1 - s.width(head)))}┐`);
  const lines = [top];
  for (let i = 0; i < height - 2; i++) lines.push(s.fg(tone, "│") + s.truncate(body[i] ?? "", inner, true) + s.fg(tone, "│"));
  lines.push(s.fg(tone, `└${"─".repeat(inner)}┘`));
  return lines;
}

const home = process.env.HOME ?? "";
const tildify = (path: string) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);

/** Body lines (event log or last output) for the detail pane. */
function bodyLines(record: WatchRecord, view: BodyView, width: number, s: Style): string[] {
  const { watch } = record;
  if (view === "activity") {
    return record.log.map((entry) => {
      const text = entry.tone ? s.fg(entry.tone, entry.text) : entry.text;
      return `${s.fg("dim", clock(entry.at))} ${text}${entry.repeat > 1 ? s.fg("muted", ` ×${entry.repeat}`) : ""}`;
    });
  }
  const error = record.ended?.reason === "error" && record.ended.detail ? [...s.wrap(s.fg("error", record.ended.detail), width), ""] : [];
  if (watch.kind === "prompt") return [...error, ...s.wrap(expandTabs(watch.text), width)];
  if (!watch.last) return [...error, s.fg("dim", "No check has finished yet")];
  const out = outputText(watch.last);
  const head = s.fg("muted", `Last check ${exitText(watch.last)}`);
  return [...error, head, "", ...(out ? s.wrap(expandTabs(tail(out, 500, 50_000)), width) : [s.fg("dim", "(no output)")])];
}

function detail(record: WatchRecord, state: PopupState, now: number, width: number, height: number, s: Style) {
  const { watch } = record;
  const label = (name: string) => s.fg("muted", name.padEnd(6));
  const left = record.ended
    ? `ended ${clock(record.ended.at)}`
    : `${duration(watch.deadline - now)} left`;
  const mode = watch.kind === "prompt"
    ? "loop · runs when idle"
    : `command · until ${watch.until} · deliver ${watch.deliver}`;
  const counts = watch.kind === "prompt"
    ? counter(watch)
    : `${counter(watch)} · fired ${watch.fires}${watch.last ? ` · last ${exitText(watch.last)}` : ""}`;
  const textLines = s.wrap(expandTabs(watch.text), width - 7);
  const head = [
    `${label("kind")} ${mode}`,
    `${label("cwd")} ${tildify(watch.cwd)}`,
    `${label("every")} ${formatDuration(watch.intervalMs)} ${s.fg("dim", `· timeout ${formatDuration(watch.timeoutMs)} · ${left}`)}`,
    `${label("count")} ${counts}`,
    `${label("status")} ${status(record, now)}`,
    ...textLines.slice(0, 3).map((line, i) => `${label(i ? "" : watch.kind === "prompt" ? "prompt" : "cmd")} ${line}`),
    ...(textLines.length > 3 ? [`${label("")} ${s.fg("dim", `… ${textLines.length - 3} more lines`)}`] : []),
  ];
  const other = state.view === "activity" ? "output" : "activity";
  const divider = rule(s.fg("accent", state.view), `a: ${other}`, width, s);
  const room = Math.max(1, height - head.length - 1);
  const body = bodyLines(record, state.view, width, s);
  const maxScroll = Math.max(0, body.length - room);
  const scroll = state.scroll === "end" ? maxScroll : Math.min(state.scroll, maxScroll);
  // Write back so later key presses scroll from what's on screen.
  if (state.scroll !== "end") state.scroll = scroll;
  return { lines: [...head, divider, ...body.slice(scroll, scroll + room)], room };
}

export interface PopupRender {
  lines: string[];
  /** Body height, for paging. */
  page: number;
}

export function popupLines(records: WatchRecord[], state: PopupState, now: number, width: number, height: number, s: Style, frame: number): PopupRender {
  const help = state.focus === "list"
    ? "j/k move · enter focus details · a activity/output · x stop · esc close"
    : "j/k scroll · g/G top/bottom · a activity/output · x stop · esc back";
  const paneH = Math.max(4, height - 1);
  const leftW = Math.min(44, Math.max(24, Math.round(width * 0.35)));
  const rightW = Math.max(20, width - leftW);
  const active = records.filter((r) => !r.ended).length;
  const title = `${s.bold("Watches")} ${s.fg("muted", `${active}/${records.length}`)}`;
  const footer = `${summary(records)} `;

  const listRows = paneH - 2;
  const selectedIndex = Math.max(0, records.findIndex((r) => r.key === state.selected));
  // Scroll just enough to keep the selection visible.
  const first = Math.max(0, selectedIndex - listRows + 1);
  const innerLeft = leftW - 2;
  const list = records.slice(first, first + listRows).map((record) => {
    const isSelected = record.key === state.selected;
    const age = duration((record.ended?.at ?? now) - record.watch.startedAt);
    const lead = `${isSelected ? s.fg("accent", "▸") : " "}${icon(record, frame, s)} ${s.fg("accent", `#${record.watch.id}`)} ${s.fg("muted", kindLabel(record.watch).padEnd(5))} `;
    const room = innerLeft - s.width(lead) - s.width(age) - 1;
    const row = lead + s.truncate(record.watch.description, Math.max(1, room), true) + " " + s.fg("dim", age);
    return isSelected ? s.selected(s.truncate(row, innerLeft, true)) : row;
  });
  if (!records.length) list.push(s.fg("dim", " No watches yet"));
  const left = box(title, list, leftW, paneH, state.focus === "list", s);

  const record = records[selectedIndex];
  let page = 1;
  let rightBody: string[] = [];
  let rightTitle = "Details";
  if (record) {
    rightTitle = `${s.fg("accent", `#${record.watch.id}`)} ${record.watch.description} ${s.fg("dim", `· ${status(record, now)}`)}`;
    // One-column gutter inside the border.
    const rendered = detail(record, state, now, rightW - 3, paneH - 2, s);
    rightBody = rendered.lines.map((line) => ` ${line}`);
    page = rendered.room;
  }
  const right = box(rightTitle, rightBody, rightW, paneH, state.focus === "detail", s);

  const lines = left.map((line, i) => line + right[i]);
  const gap = width - s.width(help) - s.width(footer) - 1;
  lines.push(gap >= 1
    ? s.fg("dim", ` ${help}${" ".repeat(gap)}`) + s.fg("muted", footer)
    : s.truncate(s.fg("dim", ` ${help}`), width));
  return { lines, page };
}

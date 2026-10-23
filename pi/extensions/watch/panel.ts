import { box, duration, expandTabs, padStart, SPINNER, tildify, wallClock, type Style } from "../run-panel/format.ts";
import { count, exitText, outputText } from "./report.ts";
import { END_MARK, endText, type WatchRecord } from "./store.ts";
import { formatDuration, tail, type Watch } from "./watcher.ts";

// Rendering for the below-editor widget and the /watches popup; the records come from
// store.ts. Styling is injected (Pi's theme and pi-tui in production) so layout is
// testable without Pi.

export const WIDGET_ROWS = 5;

// ── Formatting ───────────────────────────────────────────────────────────

const kindLabel = (watch: Watch) => watch.kind === "prompt" ? "loop" : "watch";

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

/** Where a navigation key moves the list selection; other keys leave it in place. */
function moveIndex(key: PopupKey, index: number, last: number, page: number): number {
  switch (key) {
    case "up": return index - 1;
    case "down": return index + 1;
    case "pageUp": return index - page;
    case "pageDown": return index + page;
    case "top": return 0;
    case "bottom": return last;
    default: return index;
  }
}

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
    const target = moveIndex(key, index, last, page);
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

/** Body lines (event log or last output) for the detail pane. */
function bodyLines(record: WatchRecord, view: BodyView, width: number, s: Style): string[] {
  const { watch } = record;
  if (view === "activity") {
    return record.log.map((entry) => {
      const text = entry.tone ? s.fg(entry.tone, entry.text) : entry.text;
      return `${s.fg("dim", wallClock(entry.at))} ${text}${entry.repeat > 1 ? s.fg("muted", ` ×${entry.repeat}`) : ""}`;
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
    ? `ended ${wallClock(record.ended.at)}`
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

/** Index of the selected record, or 0 when the selection is gone (e.g. pruned). */
const selectedIndex = (records: WatchRecord[], state: PopupState) =>
  Math.max(0, records.findIndex((r) => r.key === state.selected));

/** Rows of the list pane, scrolled just enough to keep the selection visible. */
function listRows(records: WatchRecord[], state: PopupState, now: number, innerWidth: number, rows: number, frame: number, s: Style): string[] {
  if (!records.length) return [s.fg("dim", " No watches yet")];
  const first = Math.max(0, selectedIndex(records, state) - rows + 1);
  return records.slice(first, first + rows).map((record) => {
    const isSelected = record.key === state.selected;
    const age = duration((record.ended?.at ?? now) - record.watch.startedAt);
    const lead = `${isSelected ? s.fg("accent", "▸") : " "}${icon(record, frame, s)} ${s.fg("accent", `#${record.watch.id}`)} ${s.fg("muted", kindLabel(record.watch).padEnd(5))} `;
    const room = innerWidth - s.width(lead) - s.width(age) - 1;
    const row = lead + s.truncate(record.watch.description, Math.max(1, room), true) + " " + s.fg("dim", age);
    return isSelected ? s.selected(s.truncate(row, innerWidth, true)) : row;
  });
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

  const list = listRows(records, state, now, leftW - 2, paneH - 2, frame, s);
  const left = box(title, list, leftW, paneH, state.focus === "list", s);

  const record = records[selectedIndex(records, state)];
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

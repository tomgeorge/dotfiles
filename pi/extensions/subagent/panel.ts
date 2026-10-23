import type { JobRecord } from "./jobs.ts";

// Rendering for the below-editor widget and the /subagents popup. Styling and
// terminal-width handling are injected (Pi's theme and pi-tui in production) so
// layout is testable without Pi.

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
  /** Render markdown (tasks and results) to lines no wider than `width`. */
  markdown(text: string, width: number): string[];
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const WIDGET_ROWS = 5;

export function duration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
}

export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function elapsed(job: JobRecord, now: number) {
  return (job.ended ?? now) - job.started;
}

/** One-line run summary appended to the tool result, so spend outlives the live status line. */
export function summary(job: JobRecord, now: number): string {
  const { toolCalls, usage } = job.progress;
  return `Subagent #${job.id} ${job.model} · ${duration(elapsed(job, now))} · ${toolCalls} tool calls · ${money(usage.cost)} · ${tokens(usage.input)} in / ${tokens(usage.output)} out`;
}

/** The live line streamed into the tool row; elapsed time keeps counting until the tool returns. */
export function progressLine(job: JobRecord, now: number): string {
  const { toolCalls, usage } = job.progress;
  return `Subagent #${job.id} ${job.model} · ${duration(now - job.started)} · ${toolCalls} tool calls · ${money(usage.cost)} · ${doing(job)}`;
}

/** What the job is doing now, or how it ended. */
export function doing(job: JobRecord): string {
  if (job.status === "ok") return "done";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "error") return job.error?.split("\n")[0] || "failed";
  switch (job.progress.phase) {
    case "tool": return job.progress.activity;
    case "starting": return "starting…";
    default: return `${job.progress.phase}…`;
  }
}

function icon(job: JobRecord, frame: number, s: Style) {
  switch (job.status) {
    case "running": return s.fg("accent", SPINNER[frame % SPINNER.length]);
    case "ok": return s.fg("success", "✓");
    case "error": return s.fg("error", "✗");
    case "cancelled": return s.fg("warning", "⊘");
  }
}

const spent = (jobs: JobRecord[]) => jobs.reduce((sum, job) => sum + job.progress.usage.cost, 0);

const padStart = (text: string, width: number, s: Style) => " ".repeat(Math.max(0, width - s.width(text))) + text;

/** A rule with a left title and optional right hint, e.g. `─ Subagents ───── hint ─`. */
function rule(left: string, right: string, width: number, s: Style) {
  const head = `─ ${left} `;
  const tail = right ? ` ${right} ─` : "─";
  const fill = width - s.width(head) - s.width(tail);
  if (fill < 1) return s.truncate(s.fg("border", "─ ") + left, width);
  return s.fg("border", "─ ") + left + s.fg("border", ` ${"─".repeat(fill)}`) + (right ? ` ${s.fg("dim", right)} ${s.fg("border", "─")}` : s.fg("border", "─"));
}

/** Below-editor widget: running jobs only, capped at WIDGET_ROWS. Empty when nothing runs. */
export function widgetLines(jobs: JobRecord[], now: number, width: number, s: Style, opts: { frame: number; hint: string }): string[] {
  const running = jobs.filter((job) => job.status === "running");
  if (!running.length) return [];
  const total = spent(jobs);
  const shown = running.length > WIDGET_ROWS ? running.slice(0, WIDGET_ROWS - 1) : running;
  const modelW = Math.min(24, Math.max(...shown.map((job) => s.width(job.model))));
  const idW = Math.max(...shown.map((job) => `#${job.id}`.length));
  const lines = [rule(`${s.bold("Subagents")} ${s.fg("muted", `· ${running.length} running · ${money(total)}`)}`, opts.hint, width, s)];
  for (const job of shown) {
    const cells = [
      ` ${icon(job, opts.frame, s)}`,
      s.fg("accent", `#${job.id}`.padEnd(idW)),
      s.fg("muted", s.truncate(job.model, modelW, true)),
      padStart(duration(elapsed(job, now)), 6, s),
      s.fg("dim", padStart(`${job.progress.toolCalls}`, 3, s) + " tools"),
      s.fg("dim", padStart(money(job.progress.usage.cost), 6, s)),
      job.progress.phase === "tool" ? doing(job) : s.fg("dim", doing(job)),
    ];
    lines.push(s.truncate(cells.join("  "), width));
  }
  if (shown.length < running.length) {
    lines.push(s.fg("dim", `   +${running.length - shown.length} more · ${opts.hint} to view all`));
  }
  return lines;
}

// ── Popup ────────────────────────────────────────────────────────────────

export type Focus = "list" | "detail";
export type BodyView = "activity" | "result" | "task";

export interface PopupState {
  /** Selected job id. */
  selected: number | undefined;
  focus: Focus;
  /** Body scroll offset in lines; "end" follows the tail. */
  scroll: number | "end";
  /** Explicit body view; otherwise running jobs show activity, finished ones the result. */
  view?: BodyView;
  /** When true, show the full task instead of truncating. */
  expandTask?: boolean;
}

export type PopupKey =
  | "up" | "down" | "pageUp" | "pageDown" | "top" | "bottom"
  | "enter" | "back" | "toggle" | "task" | "expand" | "cancel" | "close";

export type PopupAction = { type: "none" } | { type: "close" } | { type: "cancel"; id: number };

export function initialPopup(jobs: JobRecord[]): PopupState {
  // Newest running job, else the newest job.
  const pick = [...jobs].reverse().find((job) => job.status === "running") ?? jobs.at(-1);
  const state: PopupState = { selected: pick?.id, focus: "list", scroll: 0 };
  resetScroll(state, pick);
  return state;
}

export function bodyView(state: PopupState, job: JobRecord): BodyView {
  return state.view ?? (job.status === "running" ? "activity" : "result");
}

function resetScroll(state: PopupState, job: JobRecord | undefined) {
  state.scroll = job && bodyView(state, job) === "activity" ? "end" : 0;
}

/** Apply a key. `page` is the body height, for paging. Mutates `state`. */
export function popupKey(state: PopupState, jobs: JobRecord[], key: PopupKey, page: number): PopupAction {
  const index = jobs.findIndex((job) => job.id === state.selected);
  const job = jobs[index];
  if (key === "close") return { type: "close" };
  if (key === "cancel") return job?.status === "running" ? { type: "cancel", id: job.id } : { type: "none" };
  if (key === "toggle" && job) {
    state.view = bodyView(state, job) === "activity" ? "result" : "activity";
    resetScroll(state, job);
    return { type: "none" };
  }
  if (key === "task" && job) {
    // Toggle back to the job's default view.
    state.view = bodyView(state, job) === "task" ? undefined : "task";
    state.expandTask = false;
    resetScroll(state, job);
    return { type: "none" };
  }
  if (key === "expand" && job) {
    state.expandTask = !state.expandTask;
    // Start an expanded task from its first line; collapsing restores the view's usual position.
    if (state.expandTask) state.scroll = 0;
    else resetScroll(state, job);
    return { type: "none" };
  }
  if (state.focus === "list") {
    if (key === "back") return { type: "close" };
    if (key === "enter") { if (job) state.focus = "detail"; return { type: "none" }; }
    const last = jobs.length - 1;
    const target = key === "up" ? index - 1 : key === "down" ? index + 1
      : key === "top" ? 0 : key === "bottom" ? last
      : key === "pageUp" ? index - page : key === "pageDown" ? index + page : index;
    const next = jobs[Math.min(last, Math.max(0, target))];
    if (next && next.id !== state.selected) {
      state.selected = next.id;
      state.view = undefined;
      resetScroll(state, next);
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

function clock(ms: number) {
  const secs = Math.floor(ms / 1000);
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

/** Body lines (activity log or result) for the detail pane. */
export function bodyLines(job: JobRecord, view: BodyView, width: number, s: Style): string[] {
  if (view === "activity") {
    if (!job.log.length) return [s.fg("dim", "No tool calls yet")];
    return job.log.map((entry) => `${s.fg("dim", clock(entry.at))} ${entry.text}`);
  }
  if (view === "task") return s.markdown(job.task, width);
  if (job.status === "running") return [s.fg("dim", "Still running")];
  const error = job.error ? s.wrap(s.fg("error", job.error), width) : [];
  const result = job.result ? s.markdown(job.result, width) : [];
  if (!error.length && !result.length) return [s.fg("dim", "No output")];
  return error.length && result.length ? [...error, "", ...result] : [...error, ...result];
}

function detail(job: JobRecord, state: PopupState, width: number, height: number, s: Style) {
  const label = (name: string) => s.fg("muted", name.padEnd(6));
  const git = job.git === undefined ? s.fg("dim", "…") : job.git === null ? s.fg("dim", "not a git checkout")
    : s.fg("accent", job.git.branch) + (job.git.worktree ? s.fg("warning", " (worktree)") : "");
  const u = job.progress.usage;
  const taskLines = s.wrap(job.task, width - 7);
  const taskExpanded = state.expandTask ?? false;
  const taskRows = (taskExpanded ? taskLines : taskLines.slice(0, 3)).map((line, i) => `${label(i ? "" : "task")} ${line}`);
  const head = [
    `${label("cwd")} ${tildify(job.cwd)}`,
    `${label("git")} ${git}`,
    `${label("tools")} ${job.tools.join(" ")}`,
    `${label("spend")} ${money(u.cost)} ${s.fg("dim", `· ${tokens(u.input)} in / ${tokens(u.output)} out`)}`,
    `${label("calls")} ${job.progress.toolCalls} ${s.fg("dim", `· ${doing(job)}`)}`,
    // Expanded, the task can be taller than the pane, so it scrolls with the body instead.
    ...(taskExpanded ? [] : taskRows),
    ...(taskLines.length > 3 && !taskExpanded ? [`${label("")} ${s.fg("dim", `… ${taskLines.length - 3} more lines · ctrl+o to expand`)}`] : []),
  ];
  const view = bodyView(state, job);
  const other = view === "activity" ? "result" : "activity";
  const divider = rule(s.fg("accent", view), `a: ${other} · t: ${view === "task" ? "back" : "task"}`, width, s);
  const room = Math.max(1, height - head.length - (taskExpanded ? 0 : 1));
  const viewLines = bodyLines(job, view, width, s);
  const body = taskExpanded ? [...taskRows, divider, ...viewLines] : viewLines;
  const maxScroll = Math.max(0, body.length - room);
  const scroll = state.scroll === "end" ? maxScroll : Math.min(state.scroll, maxScroll);
  // Write back so later key presses scroll from what's on screen.
  if (state.scroll !== "end") state.scroll = scroll;
  const shown = body.slice(scroll, scroll + room);
  return { lines: taskExpanded ? [...head, ...shown] : [...head, divider, ...shown], room };
}

export interface PopupRender {
  lines: string[];
  /** Body height, for paging. */
  page: number;
}

export function popupLines(jobs: JobRecord[], state: PopupState, now: number, width: number, height: number, s: Style, frame: number): PopupRender {
  const help = state.focus === "list"
    ? "j/k move · enter focus details · a activity/result · t task · x cancel · esc close"
    : "j/k scroll · ctrl+d/u page · g/G top/bottom · a activity/result · t task · ctrl+o expand · x cancel · esc back";
  const paneH = Math.max(4, height - 1);
  const leftW = Math.min(44, Math.max(24, Math.round(width * 0.35)));
  const rightW = Math.max(20, width - leftW);
  const running = jobs.filter((job) => job.status === "running").length;
  const title = `${s.bold("Subagents")} ${s.fg("muted", `${running}/${jobs.length}`)}`;
  const spend = `${running} running · ${money(spent(jobs))} spent `;

  const listRows = paneH - 2;
  const selectedIndex = Math.max(0, jobs.findIndex((job) => job.id === state.selected));
  // Scroll just enough to keep the selection visible.
  const first = Math.max(0, selectedIndex - listRows + 1);
  const innerLeft = leftW - 2;
  const list = jobs.slice(first, first + listRows).map((job) => {
    const isSelected = job.id === state.selected;
    const time = duration(elapsed(job, now));
    const lead = `${isSelected ? s.fg("accent", "▸") : " "}${icon(job, frame, s)} ${s.fg("accent", `#${job.id}`)} `;
    const room = innerLeft - s.width(lead) - s.width(time) - 1;
    const row = lead + s.truncate(job.model, Math.max(1, room), true) + " " + s.fg("dim", time);
    return isSelected ? s.selected(s.truncate(row, innerLeft, true)) : row;
  });
  if (!jobs.length) list.push(s.fg("dim", " No subagents yet"));
  const left = box(title, list, leftW, paneH, state.focus === "list", s);

  const job = jobs[selectedIndex];
  let page = 1;
  let rightBody: string[] = [];
  let rightTitle = "Details";
  if (job) {
    rightTitle = `${s.fg("accent", `#${job.id}`)} ${job.model} ${s.fg("dim", `· ${job.status} ${duration(elapsed(job, now))}`)}`;
    // One-column gutter inside the border.
    const rendered = detail(job, state, rightW - 3, paneH - 2, s);
    rightBody = rendered.lines.map((line) => ` ${line}`);
    page = rendered.room;
  }
  const right = box(rightTitle, rightBody, rightW, paneH, state.focus === "detail", s);

  const lines = left.map((line, i) => line + right[i]);
  const gap = width - s.width(help) - s.width(spend) - 1;
  lines.push(gap >= 1
    ? s.fg("dim", ` ${help}${" ".repeat(gap)}`) + s.fg("muted", spend)
    : s.truncate(s.fg("dim", ` ${help}`), width));
  return { lines, page };
}

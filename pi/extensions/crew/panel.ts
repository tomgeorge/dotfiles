import { git as runGit, type GitResult } from "./git.ts";
import type { CheckResult, TaskReport } from "./handoff.ts";
import { runningTasks, spent, type CrewState, type ModelRef, type TaskRecord, type TaskStatus } from "./state.ts";

// The /crew panel: a lazygit-style view of one crew. Styling and terminal-width handling are
// injected (Pi's theme and pi-tui in production), as in the subagent and watch panels, so
// layout and keys are testable without Pi. Read-only apart from cancelling a running task.

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

export const TABS = ["overview", "spec", "handoff", "checks", "diff"] as const;
export type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", spec: "Spec", handoff: "Handoff", checks: "Checks", diff: "Diff" };

/** Panes sit side by side from this panel width; below it they stack. */
export const SIDE_BY_SIDE = 100;
/** A running task with no stream event for this long is shown as quiet. */
export const QUIET_MS = 60_000;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TAIL_LINES = 40;

// ── Formatting ───────────────────────────────────────────────────────────

export function duration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
}

const money = (usd: number) => `$${usd.toFixed(2)}`;
const ref = (m: ModelRef) => `${m.provider}/${m.model}`;
const home = process.env.HOME ?? "";
const tildify = (path: string) => (home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);

/** Worker output and check tails can carry ANSI colours and tabs; either breaks column math. */
export function clean(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b./g, "")
    .replace(/\t/g, "    ")
    .replace(/\r/g, "")
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "");
}

const oneLine = (text: string) => clean(text).replace(/\s+/g, " ").trim();

/** `quiet 2m` for a running task that has gone silent, in warning colour, or error past stallMin. */
export function quiet(task: TaskRecord, now: number, stallMin: number): { text: string; tone: Tone } | undefined {
  if (task.status !== "running") return undefined;
  const ms = now - task.lastEventAt;
  if (ms <= QUIET_MS) return undefined;
  const mins = Math.floor(ms / 60_000);
  const text = `quiet ${mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`}`;
  return { text, tone: ms >= stallMin * 60_000 ? "error" : "warning" };
}

const STATUS_TONE: Record<TaskStatus, Tone> = {
  running: "accent", submitted: "success", integrated: "success", conflict: "error",
  failed: "error", cancelled: "warning", timeout: "warning", interrupted: "warning",
};

function glyph(task: TaskRecord, frame: number, s: Style): string {
  const g: Record<TaskStatus, string> = {
    running: SPINNER[frame % SPINNER.length], submitted: "✓", integrated: "●", conflict: "!",
    failed: "✗", cancelled: "⊘", timeout: "◷", interrupted: "◌",
  };
  return s.fg(STATUS_TONE[task.status], g[task.status]);
}

const elapsed = (t: TaskRecord, now: number) => (t.endedAt ?? now) - t.startedAt;
const padStart = (text: string, width: number, s: Style) => " ".repeat(Math.max(0, width - s.width(text))) + text;

// ── Filtering ────────────────────────────────────────────────────────────

/** Subsequence match; lower scores are better. Undefined when `query` isn't in `text` in order. */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let last = -1;
  for (const ch of q) {
    const i = t.indexOf(ch, last + 1);
    if (i < 0) return undefined;
    if (i === last + 1 && last >= 0) score -= 5;
    else if (last >= 0) score += i - last - 1;
    if (i === 0 || /[\s\-_./:#]/.test(t[i - 1])) score -= 8;
    score += i * 0.01;
    last = i;
  }
  return score;
}

/** What the filter searches. A token matches within one field, so letters scattered across fields don't. */
export const searchFields = (t: TaskRecord) => [`#${t.id}`, t.status, t.kind, t.title, t.branch ?? ""];

const fieldScore = (token: string, fields: string[]) =>
  fields.reduce<number | undefined>((best, field) => {
    const score = fuzzyScore(token, field);
    return score !== undefined && (best === undefined || score < best) ? score : best;
  }, undefined);

/** Tasks matching every space-separated token, best first; id order breaks ties. */
export function filterTasks(tasks: TaskRecord[], query: string): TaskRecord[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return tasks;
  const scored: { task: TaskRecord; score: number }[] = [];
  for (const task of tasks) {
    const fields = searchFields(task);
    let total = 0;
    for (const token of tokens) {
      const score = fieldScore(token, fields);
      if (score === undefined) { total = NaN; break; }
      total += score;
    }
    if (!Number.isNaN(total)) scored.push({ task, score: total });
  }
  return scored.sort((a, b) => a.score - b.score || a.task.id - b.task.id).map((x) => x.task);
}

// ── State and input ──────────────────────────────────────────────────────

export interface PanelState {
  /** Selected task id. */
  selected: number | undefined;
  query: string;
  /** Keys go to the filter query rather than to actions. */
  filtering: boolean;
  focus: "list" | "detail";
  tab: Tab;
  /** Detail body scroll offset in lines. */
  scroll: number;
  /** Selected check on the Checks tab. */
  checkCursor: number;
  /** Keep the check cursor on screen at the next render. */
  followCursor?: boolean;
  /** Per `${taskId}:${index}` overrides of whether a check's output is open. */
  expanded: Record<string, boolean>;
  /** Detail pane fills the panel. */
  zoom: boolean;
  help: boolean;
  /** Awaiting y to cancel this task. */
  confirm?: number;
  /** One-line message in the footer until the next key. */
  flash?: { text: string; tone: Tone };
}

export type PanelKey =
  | "up" | "down" | "pageUp" | "pageDown" | "top" | "bottom" | "enter" | "left" | "escape"
  | "tab" | "backTab" | "backspace" | "zoom" | "close";

export type PanelInput = { key: PanelKey } | { char: string };

export type PanelAction = { type: "none" } | { type: "close" } | { type: "cancel"; id: number } | { type: "open"; id: number };

export function initialPanel(crew: CrewState | undefined): PanelState {
  const tasks = crew?.tasks ?? [];
  // Newest running task, else the newest task.
  const pick = [...tasks].reverse().find((t) => t.status === "running") ?? tasks.at(-1);
  return { selected: pick?.id, query: "", filtering: false, focus: "list", tab: "overview", scroll: 0, checkCursor: 0, expanded: {}, zoom: false, help: false };
}

/** The visible tasks and the selected one, re-anchoring the selection when the filter hides it. */
export function visible(state: PanelState, tasks: TaskRecord[]): { shown: TaskRecord[]; task: TaskRecord | undefined; index: number } {
  const shown = filterTasks(tasks, state.query);
  let index = shown.findIndex((t) => t.id === state.selected);
  if (index < 0 && shown.length) {
    index = 0;
    select(state, shown[0]);
  }
  return { shown, task: shown[index], index };
}

function select(state: PanelState, task: TaskRecord) {
  if (task.id === state.selected) return;
  state.selected = task.id;
  state.scroll = 0;
  state.checkCursor = 0;
}

function setTab(state: PanelState, tab: Tab) {
  if (tab === state.tab) return;
  state.tab = tab;
  state.scroll = 0;
}

const KEY_CHARS: Record<string, PanelKey> = { j: "down", k: "up", g: "top", G: "bottom", l: "enter", h: "left", q: "close", " ": "enter" };

export interface InputOptions {
  /** Body height, for paging. */
  page: number;
  /** The crew runs in this session, so its tasks can be cancelled. */
  live: boolean;
}

/** Apply one key press. Mutates `state`. */
export function panelInput(state: PanelState, tasks: TaskRecord[], input: PanelInput, opts: InputOptions): PanelAction {
  state.flash = undefined;
  const key = "key" in input ? input.key : undefined;
  const char = "char" in input ? input.char : undefined;
  if (key === "close") return { type: "close" };

  if (state.confirm !== undefined) {
    const id = state.confirm;
    state.confirm = undefined;
    if (char === "y" || char === "Y") return { type: "cancel", id };
    state.flash = { text: `#${id} keeps running`, tone: "dim" };
    return { type: "none" };
  }
  if (state.help) {
    state.help = false;
    return char === "q" ? { type: "close" } : { type: "none" };
  }

  if (state.filtering) {
    if (char !== undefined) { state.query += char; return { type: "none" }; }
    if (key === "backspace") {
      state.query = state.query.slice(0, -1);
      if (!state.query) state.filtering = false;
      return { type: "none" };
    }
    if (key === "escape") { state.query = ""; state.filtering = false; return { type: "none" }; }
    if (key === "enter" || key === "tab") { state.filtering = false; return { type: "none" }; }
    return move(state, tasks, key!, opts.page);
  }

  if (char !== undefined) {
    if (/^[1-5]$/.test(char)) { setTab(state, TABS[Number(char) - 1]); return { type: "none" }; }
    if (char === "?") { state.help = true; return { type: "none" }; }
    if (char === "x" || char === "o") {
      const { task } = visible(state, tasks);
      if (!task) return { type: "none" };
      if (char === "o") return { type: "open", id: task.id };
      if (task.status !== "running") state.flash = { text: `#${task.id} is not running`, tone: "warning" };
      else if (!opts.live) state.flash = { text: "This crew isn't running in this session; nothing to cancel", tone: "warning" };
      else state.confirm = task.id;
      return { type: "none" };
    }
    const mapped = KEY_CHARS[char];
    if (mapped === "close") return { type: "close" };
    if (mapped) return move(state, tasks, mapped, opts.page);
    // Any other printable key starts a filter: type to jump.
    state.filtering = true;
    if (char !== "/") state.query = char;
    return { type: "none" };
  }

  switch (key) {
    case "tab": case "backTab": {
      const i = TABS.indexOf(state.tab) + (key === "tab" ? 1 : -1);
      setTab(state, TABS[(i + TABS.length) % TABS.length]);
      return { type: "none" };
    }
    case "zoom": state.zoom = !state.zoom; return { type: "none" };
    case "backspace": return { type: "none" };
    case "escape":
      if (state.query) state.query = "";
      else if (state.focus === "detail") state.focus = "list";
      else if (state.zoom) state.zoom = false;
      else return { type: "close" };
      return { type: "none" };
    default: return move(state, tasks, key!, opts.page);
  }
}

function move(state: PanelState, tasks: TaskRecord[], key: PanelKey, page: number): PanelAction {
  const { shown, task, index } = visible(state, tasks);
  // Paging always scrolls the details, so a long diff reads without leaving the list.
  if (key === "pageUp" || key === "pageDown") {
    state.scroll = Math.max(0, state.scroll + (key === "pageDown" ? page : -page));
    return { type: "none" };
  }
  if (state.focus === "list" && !state.filtering) {
    if (key === "enter") { if (task) state.focus = "detail"; return { type: "none" }; }
    if (key === "left") return { type: "none" };
  }
  if (state.focus === "detail" && !state.filtering) {
    if (key === "left") { state.focus = "list"; return { type: "none" }; }
    if (state.tab === "checks" && task) {
      const count = task.checks.length;
      if (key === "enter" && count) {
        const k = `${task.id}:${state.checkCursor}`;
        state.expanded[k] = !checkOpen(state, task, state.checkCursor);
        state.followCursor = true;
        return { type: "none" };
      }
      const step = key === "down" ? 1 : key === "up" ? -1 : key === "top" ? -Infinity : key === "bottom" ? Infinity : 0;
      if (step && count) {
        state.checkCursor = Math.min(count - 1, Math.max(0, state.checkCursor + step));
        state.followCursor = true;
      }
      return { type: "none" };
    }
    if (key === "enter") { state.focus = "list"; return { type: "none" }; }
    if (key === "top") state.scroll = 0;
    else if (key === "bottom") state.scroll = Number.MAX_SAFE_INTEGER;
    else if (key === "up" || key === "down") state.scroll = Math.max(0, state.scroll + (key === "down" ? 1 : -1));
    return { type: "none" };
  }
  const last = shown.length - 1;
  const target = key === "up" ? index - 1 : key === "down" ? index + 1 : key === "top" ? 0 : key === "bottom" ? last : index;
  const next = shown[Math.min(last, Math.max(0, target))];
  if (next) select(state, next);
  return { type: "none" };
}

// ── Diff ─────────────────────────────────────────────────────────────────

export type DiffView =
  | { state: "loading" }
  | { state: "unavailable"; message: string }
  | { state: "ready"; range: string; lines: string[] };

/** Base and branch whose diff the task's Diff tab shows. A review shows the task it reviews. */
export function diffTarget(crew: CrewState, task: TaskRecord): { base: string; branch: string } | { message: string } {
  const source = task.reviewOf ? crew.tasks.find((t) => t.id === task.reviewOf) : task;
  if (!source) return { message: `Reviewed task #${task.reviewOf} is not in the ledger` };
  if (!source.base || !source.branch) return { message: task.status === "running" ? "The worktree is still being set up" : "This task has no branch" };
  return { base: source.base, branch: source.branch };
}

/**
 * Lazily loads `git diff base..branch` for the task on screen, keyed by the branch tip so a
 * diff is computed once per commit. While a task's diff is visible its tip is rechecked at
 * most every `recheckMs`; nothing runs for tasks or tabs that aren't shown.
 */
export class DiffCache {
  private entries = new Map<number, { key?: string; view: DiffView; checkedAt: number; busy: boolean }>();
  private readonly run: (cwd: string, args: string[]) => Promise<GitResult>;
  private readonly maxBytes: number;
  private readonly recheckMs: number;

  constructor(run: (cwd: string, args: string[]) => Promise<GitResult> = runGit, maxBytes = 1_000_000, recheckMs = 3_000) {
    this.run = run;
    this.maxBytes = maxBytes;
    this.recheckMs = recheckMs;
  }

  get(taskId: number, repoRoot: string, base: string, branch: string, onChange: () => void, now = Date.now()): DiffView {
    let entry = this.entries.get(taskId);
    if (!entry) {
      entry = { view: { state: "loading" }, checkedAt: -Infinity, busy: false };
      this.entries.set(taskId, entry);
    }
    if (!entry.busy && now - entry.checkedAt >= this.recheckMs) {
      entry.busy = true;
      entry.checkedAt = now;
      const e = entry;
      this.refresh(e, repoRoot, base, branch).finally(() => { e.busy = false; onChange(); });
    }
    return entry.view;
  }

  private async refresh(entry: { key?: string; view: DiffView }, repoRoot: string, base: string, branch: string) {
    const tip = await this.run(repoRoot, ["rev-parse", "--verify", "--quiet", `${branch}^{commit}`]);
    if (tip.code !== 0) {
      entry.key = undefined;
      entry.view = { state: "unavailable", message: `Branch ${branch} no longer exists (removed by /crew-clean?)` };
      return;
    }
    const key = `${base}..${tip.stdout.trim()}`;
    if (key === entry.key) return;
    const diff = await this.run(repoRoot, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", key]);
    if (diff.code !== 0) {
      entry.view = { state: "unavailable", message: `git diff failed: ${(diff.stderr || diff.stdout).trim()}` };
      return;
    }
    let text = diff.stdout;
    const cut = text.length > this.maxBytes;
    if (cut) text = text.slice(0, this.maxBytes);
    const lines = text.replace(/\n$/, "").split("\n").map(clean);
    if (cut) lines.push(`[diff truncated at ${this.maxBytes} bytes]`);
    entry.key = key;
    entry.view = { state: "ready", range: `${base.slice(0, 10)}..${branch}`, lines: text ? lines : [] };
  }
}

function paintDiff(line: string, s: Style): string {
  if (line.startsWith("diff --git")) return s.bold(s.fg("accent", line));
  if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) return s.fg("muted", line);
  if (line.startsWith("@@")) return s.fg("accent", line);
  if (line.startsWith("+")) return s.fg("success", line);
  if (line.startsWith("-")) return s.fg("error", line);
  if (line.startsWith("[diff truncated")) return s.fg("warning", line);
  return line;
}

// ── Rendering ────────────────────────────────────────────────────────────

export interface RenderDeps {
  /** Diff for the task, loading it on demand. Only called for the Diff tab. */
  diff(task: TaskRecord): DiffView;
  frame: number;
  /** Shown in the footer, e.g. the shortcut that closes the panel. */
  closeHint?: string;
}

export interface PanelRender {
  lines: string[];
  /** Detail body height, for paging. */
  page: number;
}

function box(title: string, body: string[], width: number, height: number, focused: boolean, s: Style, bottom = ""): string[] {
  const tone: Tone = focused ? "borderAccent" : "border";
  const inner = Math.max(1, width - 2);
  const head = s.truncate(` ${title} `, Math.max(0, inner - 1));
  const lines = [s.fg(tone, "┌─") + head + s.fg(tone, `${"─".repeat(Math.max(0, inner - 1 - s.width(head)))}┐`)];
  for (let i = 0; i < height - 2; i++) lines.push(s.fg(tone, "│") + s.truncate(body[i] ?? "", inner, true) + s.fg(tone, "│"));
  const tail = bottom && s.width(bottom) + 3 <= inner ? ` ${bottom} ` : "";
  lines.push(s.fg(tone, `└${"─".repeat(inner - s.width(tail) - (tail ? 1 : 0))}`) + tail + s.fg(tone, `${tail ? "─" : ""}┘`));
  return lines;
}

function bar(fraction: number, cells: number, s: Style): string {
  const filled = Math.max(0, Math.min(cells, Math.round(fraction * cells)));
  const tone: Tone = fraction >= 1 ? "error" : fraction >= 0.75 ? "warning" : "success";
  return s.fg(tone, "█".repeat(filled)) + s.fg("dim", "░".repeat(cells - filled));
}

export function headerLines(crew: CrewState, width: number, s: Style): string[] {
  const c = crew.config;
  const statusTone: Tone = crew.status === "active" ? "success" : crew.status === "finished" ? "accent" : "warning";
  const total = spent(crew);
  const sep = s.fg("dim", " · ");
  const goal = oneLine(c.goal);
  const line1 = `${s.bold("Crew")} ${s.fg("accent", c.slug)} ${s.fg(statusTone, crew.status)}${sep}${goal}`;
  const line2 = [
    s.fg("accent", c.integrationBranch),
    `${runningTasks(crew).length}/${c.maxConcurrent} running`,
    `${money(total)}/${money(c.budgetUsd)} ${bar(c.budgetUsd > 0 ? total / c.budgetUsd : 1, 10, s)}`,
  ].join(sep);
  const same = ref(c.reviewerModel) === ref(c.workerModel);
  const line3 = s.fg("muted", `worker ${ref(c.workerModel)} · reviewer ${same ? "same" : ref(c.reviewerModel)}`);
  // Padded, so the overlay covers what's beneath it.
  return [line1, line2, line3].map((line) => s.truncate(` ${line}`, width, true));
}

/** One list row: glyph, id, kind, title, elapsed, cost, activity. Columns drop as width shrinks. */
export function taskRow(task: TaskRecord, crew: CrewState, now: number, width: number, s: Style, opts: { selected: boolean; idW: number; frame: number }): string {
  const lead = `${opts.selected ? s.fg("accent", "▸") : " "}${glyph(task, opts.frame, s)} ${s.fg("accent", `#${task.id}`.padEnd(opts.idW))} `;
  const rest = width - s.width(lead) - 6;
  // All columns fit from a 48-column list (a 100-column panel); only narrower lists drop some.
  const showKind = rest >= 30;
  const showCost = rest >= 26;
  const showActivity = rest >= 18;
  const kind = showKind ? s.fg("muted", (task.kind === "implement" ? "impl" : "rev").padEnd(5)) : "";
  const cost = showCost ? s.fg("dim", padStart(money(task.cost), 6, s)) : "";
  const flex = rest - (showKind ? 5 : 0) - (showCost ? 6 : 0);
  const titleW = showActivity ? Math.max(8, Math.floor(flex * 0.55)) : Math.max(1, flex);
  const title = s.truncate(oneLine(task.title), titleW, true);
  const time = padStart(duration(elapsed(task, now)), 6, s);
  let activity = "";
  if (showActivity) {
    const room = Math.max(1, flex - titleW - 2);
    const hush = quiet(task, now, crew.config.stallMin);
    const text = task.status === "running" ? (hush ? `${hush.text} · ${oneLine(task.activity)}` : oneLine(task.activity)) : task.status;
    const cut = s.truncate(text, room);
    activity = `  ${hush ? s.fg(hush.tone, cut) : task.status === "running" ? cut : s.fg("dim", cut)}`;
  }
  const row = lead + kind + title + s.fg("dim", time) + cost + activity;
  return opts.selected ? s.selected(s.truncate(row, width, true)) : s.truncate(row, width);
}

function tabBar(active: Tab, width: number, s: Style): string {
  const parts = TABS.map((tab, i) => {
    const label = `${i + 1} ${TAB_LABELS[tab]}`;
    return tab === active ? s.bold(s.fg("accent", `[${label}]`)) : s.fg("dim", label);
  });
  return s.truncate(parts.join(" "), width);
}

type Body = { lines: string[]; paint?: (line: string) => string; anchor?: number };

function field(label: string, value: string, width: number, s: Style): string[] {
  const labelW = 13;
  const wrapped = s.wrap(value, Math.max(10, width - labelW));
  return wrapped.map((line, i) => `${s.fg("muted", (i ? "" : label).padEnd(labelW))}${line}`);
}

const bullets = (items: string[], width: number, s: Style, tone?: Tone) =>
  items.flatMap((item) => s.wrap(clean(item), Math.max(10, width - 2)).map((line, i) => `${i ? "  " : s.fg("dim", "- ")}${tone ? s.fg(tone, line) : line}`));

function section(title: string, tone: Tone, width: number, s: Style): string {
  const head = `── ${title} `;
  return s.fg(tone, head + "─".repeat(Math.max(0, width - 1 - s.width(head))));
}

function overview(crew: CrewState, task: TaskRecord, now: number, width: number, s: Style): Body {
  const lines: string[] = [];
  const add = (label: string, value: string) => lines.push(...field(label, value, width, s));
  const hush = quiet(task, now, crew.config.stallMin);
  const status = s.fg(STATUS_TONE[task.status], task.status)
    + (task.report?.handoff ? s.fg("dim", ` · handoff ${task.report.handoff.status}`) : "");
  add("status", status);
  add("kind", task.kind + (task.reviewOf ? ` of #${task.reviewOf}` : ""));
  add("model", task.model);
  add("branch", task.branch ?? s.fg("dim", "none"));
  add("base", task.base ? task.base.slice(0, 12) : s.fg("dim", "none"));
  add("worktree", task.worktree ? tildify(task.worktree) : s.fg("dim", "removed"));
  if (task.status === "running") {
    add("time", `${duration(now - task.startedAt)} elapsed`);
    const last = `${duration(now - task.lastEventAt)} ago`;
    add("last event", hush ? s.fg(hush.tone, `${last} (${hush.text})`) : last);
    add("activity", oneLine(task.activity) || s.fg("dim", "none"));
  } else {
    add("time", `${duration(elapsed(task, now))}${task.endedAt ? s.fg("dim", ` · ended ${duration(now - task.endedAt)} ago`) : ""}`);
  }
  add("cost", `${money(task.cost)} · ${task.toolCalls} tools`);
  add("paths", task.paths.length ? task.paths.join(", ") : s.fg("dim", "unrestricted"));
  add("checks", task.checks.length ? task.checks.join("; ") : s.fg("dim", task.kind === "review" ? "none (review)" : "none declared"));
  lines.push(s.fg("muted", "acceptance"));
  lines.push(...(task.acceptance.length ? bullets(task.acceptance, width, s) : [s.fg("dim", "  none")]));
  return { lines };
}

function handoff(task: TaskRecord, width: number, s: Style): Body {
  const r = task.report;
  if (!r) {
    const why = task.status === "running" ? "Still running; the handoff arrives when the worker finishes."
      : `No handoff recorded (${task.status}).`;
    return { lines: [s.fg("dim", why)] };
  }
  const lines = [section("Worker's claims (unverified)", "accent", width, s)];
  const h = r.handoff;
  if (h) {
    lines.push(...field("status", h.status, width, s), ...field("summary", clean(h.summary) || s.fg("dim", "none"), width, s));
    if (h.notes) lines.push(...field("notes", clean(h.notes), width, s));
    for (const [label, items] of [["concerns", h.concerns], ["deviations", h.deviations], ["findings", h.findings], ["next steps", h.next]] as const) {
      if (items.length) lines.push(s.fg("muted", label), ...bullets(items, width, s));
    }
  } else {
    lines.push(s.fg("warning", `No parseable handoff: ${r.parseError ?? "worker did not finish"}`));
    if (r.partial) lines.push(s.fg("muted", "last worker output"), ...clean(r.partial).split("\n").slice(-TAIL_LINES).flatMap((l) => s.wrap(l, width)));
  }
  lines.push("", section("Observed by the harness", "muted", width, s));
  lines.push(...field("outcome", `${r.outcome} · ${duration(r.durationMs)} · ${money(r.cost)}`, width, s));
  if (r.error) lines.push(...field("error", s.fg("error", clean(r.error)), width, s));
  if (r.kind === "implement") {
    lines.push(s.fg("muted", `commits (${r.commits.length})`), ...(r.commits.length ? bullets(r.commits, width, s) : [s.fg("dim", "  none")]));
    const stat = r.diffStat.trimEnd();
    if (stat) lines.push(s.fg("muted", "diff --stat"), ...clean(stat).split("\n").map((l) => s.truncate(l, width)));
    lines.push(...field("auto-commit", r.autoCommitted ? s.fg("warning", "yes: the worker left uncommitted changes") : "no", width, s));
    lines.push(s.fg("muted", "out of scope"), ...(r.outOfScope.length ? bullets(r.outOfScope, width, s, "warning") : [s.fg("dim", "  none")]));
  }
  if (r.dirtyAfterChecks?.length) {
    lines.push(s.fg("muted", "dirty after checks (not on the branch)"), ...bullets(r.dirtyAfterChecks, width, s, "warning"));
  } else if (r.checks.length) {
    lines.push(...field("after checks", "clean", width, s));
  }
  return { lines };
}

function verdict(c: CheckResult | undefined, task: TaskRecord, s: Style): string {
  if (!c) return s.fg("dim", task.status === "running" ? "PENDING" : "NOT RUN");
  if (c.timedOut) return s.fg("warning", "TIMEOUT");
  return c.exit === 0 ? s.fg("success", "PASS   ") : s.fg("error", `FAIL ${c.exit ?? "?"}`.padEnd(7));
}

const checkFailed = (c: CheckResult | undefined) => !!c && (c.timedOut || c.exit !== 0);

export function checkOpen(state: PanelState, task: TaskRecord, index: number): boolean {
  return state.expanded[`${task.id}:${index}`] ?? checkFailed(task.report?.checks[index]);
}

function checks(state: PanelState, task: TaskRecord, width: number, s: Style): Body {
  if (!task.checks.length) {
    return { lines: [s.fg("dim", task.kind === "review" ? "Review tasks run no checks." : "No checks declared: the work is unverified.")] };
  }
  const lines: string[] = [];
  let anchor = 0;
  const focused = state.focus === "detail";
  task.checks.forEach((command, i) => {
    const result = task.report?.checks[i];
    const open = checkOpen(state, task, i);
    const cursor = focused && i === state.checkCursor;
    if (cursor) anchor = lines.length;
    const marker = result ? (open ? "▾" : "▸") : " ";
    const head = `${cursor ? s.fg("accent", "›") : " "}${marker} ${verdict(result, task, s)} `;
    const wrapped = s.wrap(clean(command), Math.max(10, width - s.width(head)));
    lines.push(...wrapped.map((l, j) => (j ? " ".repeat(s.width(head)) : head) + l));
    if (result && open) {
      const tail = clean(result.tail).trimEnd().split("\n").slice(-TAIL_LINES);
      lines.push(...(tail.join("").trim() ? tail.map((l) => s.fg("dim", s.truncate(`    ${l}`, width))) : [s.fg("dim", "    (no output)")]));
    }
  });
  if (task.report?.dirtyAfterChecks?.length) {
    lines.push("", s.fg("warning", "The checks left uncommitted changes; passes may depend on them:"), ...bullets(task.report.dirtyAfterChecks, width, s, "warning"));
  }
  lines.push("", s.fg("dim", focused ? "j/k pick a check · enter opens or closes its output" : "enter to pick a check and open its output"));
  return { lines, anchor };
}

function diff(crew: CrewState, task: TaskRecord, deps: RenderDeps, s: Style): Body {
  const target = diffTarget(crew, task);
  if ("message" in target) return { lines: [s.fg("dim", target.message)] };
  const view = deps.diff(task);
  if (view.state === "loading") return { lines: [s.fg("dim", "Loading diff…")] };
  if (view.state === "unavailable") return { lines: [s.fg("warning", view.message)] };
  const note = task.reviewOf ? ` (task #${task.reviewOf}, under review)` : task.status === "running" ? " (commits so far; uncommitted edits not shown)" : "";
  const head = s.fg("dim", `git diff ${view.range}${note}`);
  if (!view.lines.length) return { lines: [head, s.fg("dim", "No changes yet.")] };
  return { lines: [head, ...view.lines], paint: (line) => (line === head ? line : paintDiff(line, s)) };
}

function tabBody(crew: CrewState, task: TaskRecord, state: PanelState, now: number, width: number, s: Style, deps: RenderDeps): Body {
  switch (state.tab) {
    case "overview": return overview(crew, task, now, width, s);
    case "spec": return { lines: clean(task.spec).split("\n").flatMap((l) => s.wrap(l, width)) };
    case "handoff": return handoff(task, width, s);
    case "checks": return checks(state, task, width, s);
    case "diff": return diff(crew, task, deps, s);
  }
}

export const HELP = [
  ["type, /", "filter by title, id, status, kind, or branch"],
  ["j/k, ↑/↓", "move (scroll in details)"],
  ["enter, l", "focus details · on Checks, open a check's output"],
  ["h, esc", "back to the list"],
  ["tab, 1-5", "switch tab: overview, spec, handoff, checks, diff"],
  ["ctrl+d/u", "page the details"],
  ["g/G", "top/bottom"],
  ["ctrl+o", "zoom the details to the full panel"],
  ["x", "cancel the selected running task (asks first)"],
  ["o", "copy the worktree path"],
  ["esc", "clear the filter, then close"],
  ["q", "close"],
];

function helpLines(width: number, s: Style): string[] {
  return [
    s.bold("Keys"), "",
    ...HELP.map(([keys, what]) => s.truncate(`${s.fg("accent", keys.padEnd(11))}${what}`, width)),
    "", s.fg("dim", "Read-only: integrate and dispatch stay with the planner."),
    s.fg("dim", "Any key closes this help."),
  ];
}

export function panelLines(crew: CrewState, state: PanelState, now: number, width: number, height: number, s: Style, deps: RenderDeps): PanelRender {
  const header = headerLines(crew, width, s);
  const paneH = Math.max(6, height - header.length - 1);
  const { shown, task } = visible(state, crew.tasks);

  // List pane.
  const listPane = (w: number, h: number) => {
    const rows = h - 2;
    const index = Math.max(0, shown.findIndex((t) => t.id === state.selected));
    // Scroll just enough to keep the selection visible.
    const first = Math.max(0, Math.min(index - rows + 1, shown.length - rows));
    const idW = Math.max(2, ...crew.tasks.map((t) => `#${t.id}`.length));
    const body = shown.slice(first, first + rows)
      .map((t) => taskRow(t, crew, now, w - 2, s, { selected: t.id === state.selected, idW, frame: deps.frame }));
    if (!crew.tasks.length) body.push(s.fg("dim", " No tasks yet"));
    else if (!shown.length) body.push(s.fg("dim", ` No task matches "${state.query}"`));
    const count = state.query ? `${shown.length}/${crew.tasks.length}` : `${crew.tasks.length}`;
    const filter = state.filtering ? s.fg("accent", ` /${state.query}▏`) : state.query ? s.fg("muted", ` filter: ${state.query}`) : "";
    return box(`${s.bold("Tasks")} ${s.fg("muted", count)}${filter}`, body, w, h, state.focus === "list" && !state.zoom, s);
  };

  // Detail pane.
  let page = 1;
  const detailPane = (w: number, h: number) => {
    const inner = w - 3;
    const room = Math.max(1, h - 3);
    page = room;
    if (state.help) return box(s.bold("Help"), helpLines(inner, s).map((l) => ` ${l}`), w, h, true, s);
    if (!task) return box("Details", [], w, h, false, s);
    const body = tabBody(crew, task, state, now, inner, s, deps);
    const max = Math.max(0, body.lines.length - room);
    if (state.followCursor && body.anchor !== undefined) {
      if (body.anchor < state.scroll) state.scroll = body.anchor;
      else if (body.anchor >= state.scroll + room) state.scroll = body.anchor - room + 1;
    }
    state.followCursor = false;
    // Write back so later key presses scroll from what's on screen.
    state.scroll = Math.min(state.scroll, max);
    const paint = body.paint ?? ((line: string) => line);
    const visibleLines = body.lines.slice(state.scroll, state.scroll + room).map((l) => ` ${paint(l)}`);
    const more = max > 0 ? s.fg("dim", `${state.scroll + 1}-${Math.min(body.lines.length, state.scroll + room)}/${body.lines.length}`) : "";
    const kind = task.kind + (task.reviewOf ? ` of #${task.reviewOf}` : "");
    const title = `${s.fg("accent", `#${task.id}`)} ${s.fg("muted", kind)} ${oneLine(task.title)}`;
    return box(title, [` ${tabBar(state.tab, inner, s)}`, ...visibleLines], w, h, state.focus === "detail" || state.zoom, s, more);
  };

  let panes: string[];
  if (state.zoom || state.help && width < SIDE_BY_SIDE) {
    panes = detailPane(width, paneH);
  } else if (width >= SIDE_BY_SIDE) {
    const leftW = Math.min(90, Math.max(50, Math.round(width * 0.5)));
    const left = listPane(leftW, paneH);
    const right = detailPane(width - leftW, paneH);
    panes = left.map((line, i) => line + right[i]);
  } else {
    const listH = Math.max(4, Math.min(shown.length + 2, Math.floor(paneH * 0.4)));
    panes = [...listPane(width, listH), ...detailPane(width, paneH - listH)];
  }

  return { lines: [...header, ...panes, footer(state, crew, width, s, deps)], page };
}

function footer(state: PanelState, crew: CrewState, width: number, s: Style, deps: RenderDeps): string {
  if (state.confirm !== undefined) {
    const t = crew.tasks.find((x) => x.id === state.confirm);
    return s.truncate(s.fg("warning", ` Cancel #${state.confirm} "${oneLine(t?.title ?? "")}"? Its worktree is kept. y to cancel it, any other key to keep it running`), width, true);
  }
  if (state.flash) return s.truncate(` ${s.fg(state.flash.tone, state.flash.text)}`, width, true);
  const hint = state.filtering ? "type to filter · ↑/↓ move · enter keep filter · esc clear"
    : state.focus === "detail" ? "j/k scroll · tab/1-5 tabs · ctrl+d/u page · ctrl+o zoom · h back · ? help"
    : `j/k move · type to filter · tab/1-5 tabs · enter details · x cancel · o copy path · ? help · esc ${state.query ? "clear" : "close"}`;
  return s.truncate(s.fg("dim", ` ${hint}${deps.closeHint ? ` · ${deps.closeHint}` : ""}`), width, true);
}

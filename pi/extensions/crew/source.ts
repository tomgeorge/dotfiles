import { clean, duration, oneLine, tildify, type Style, type Tone } from "../run-panel/format.ts";
import type { Action, Cell, Content, Item, Segment, Source, View } from "../run-panel/source.ts";
import { git as runGit, type GitResult } from "./git.ts";
import type { CheckResult } from "./handoff.ts";
import { money, ref, runningTasks, spent, type CrewState, type TaskRecord, type TaskStatus } from "./state.ts";
import { SessionCache, type Transcript, type TranscriptView } from "./transcript.ts";

// One crew as a source for the shared panel (run-panel/): its tasks as items, today's six tabs
// as views, and cancel, copy path, and export as actions. Layout and keys live in run-panel.

/** A running task with no stream event for this long is shown as quiet. */
const QUIET_MS = 60_000;
const TAIL_LINES = 40;

// ── Formatting ───────────────────────────────────────────────────────────

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

/** Running tasks show the spinner instead. */
const STATUS_GLYPH: Record<Exclude<TaskStatus, "running">, string> = {
  submitted: "✓", integrated: "●", conflict: "!", failed: "✗", cancelled: "⊘", timeout: "◷", interrupted: "◌",
};

const elapsed = (t: TaskRecord, now: number) => (t.endedAt ?? now) - t.startedAt;
const kindOf = (t: TaskRecord) => t.kind + (t.reviewOf ? ` of #${t.reviewOf}` : "");

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

interface DiffEntry {
  /** `base..tip` of the diff in `view`; unset until one has been computed. */
  key?: string;
  view: DiffView;
  checkedAt: number;
  busy: boolean;
}

/**
 * Lazily loads `git diff base..branch` for the task on screen, keyed by the branch tip so a
 * diff is computed once per commit. While a task's diff is visible its tip is rechecked at
 * most every `recheckMs`; nothing runs for tasks or tabs that aren't shown.
 */
export class DiffCache {
  private readonly entries = new Map<number, DiffEntry>();
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

  private async refresh(entry: DiffEntry, repoRoot: string, base: string, branch: string) {
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

// ── Source ───────────────────────────────────────────────────────────────

export interface CrewSourceDeps {
  /** The crew on screen runs in this session, so its tasks can be cancelled. */
  live(): boolean;
  /** Abort the task's worker; false when it has none in this session. */
  cancel(id: number): boolean;
  /** The streamed conversation of a worker started in this session; fresher than its session file. */
  streamed(task: TaskRecord): Transcript | undefined;
  /** Copies to the clipboard; resolves to what to show. */
  copyPath(path: string): Promise<string>;
  exportSession(session: string, output: string): Promise<void>;
  /** Sessions being exported, shared across panels so a second export waits for the first. */
  exporting: Set<string>;
  fileExists(path: string): boolean;
  /** Tests inject these; production uses git and the session files. */
  diffs?: () => Pick<DiffCache, "get">;
  sessions?: () => Pick<SessionCache, "get">;
  now?: () => number;
}

export function crewSource(getCrew: () => CrewState, deps: CrewSourceDeps): Source<TaskRecord> {
  const now = deps.now ?? Date.now;
  // Per panel: task ids repeat across crews. Dropped on close.
  const makeDiffs = deps.diffs ?? (() => new DiffCache());
  const makeSessions = deps.sessions ?? (() => new SessionCache());
  let diffs = makeDiffs();
  let sessions = makeSessions();

  const activity = (task: TaskRecord, crew: CrewState, at: number): Cell => {
    if (task.status !== "running") return { text: task.status, tone: "dim" };
    const hush = quiet(task, at, crew.config.stallMin);
    return hush ? { text: `${hush.text} · ${oneLine(task.activity)}`, tone: hush.tone } : oneLine(task.activity);
  };

  const item = (task: TaskRecord, crew: CrewState, at: number): Item<TaskRecord> => ({
    id: String(task.id),
    value: task,
    // A filter token matches within one field, so letters scattered across fields don't.
    text: [`#${task.id}`, task.status, task.kind, task.title, task.branch ?? ""],
    cells: {
      id: { text: `#${task.id}`, tone: "accent" },
      kind: task.kind === "implement" ? { text: "impl", tone: "syntaxVariable" } : { text: "rev", tone: "mdLink" },
      title: oneLine(task.title),
      time: { text: duration(elapsed(task, at)), tone: "dim" },
      cost: { text: money(task.cost), tone: "syntaxString" },
      activity: activity(task, crew, at),
    },
    glyph: task.status === "running" ? undefined : { text: STATUS_GLYPH[task.status], tone: STATUS_TONE[task.status] },
    running: task.status === "running",
    title: [{ text: `#${task.id}`, tone: "accent", bold: true }, { text: " " }, { text: kindOf(task), tone: task.kind === "implement" ? "syntaxVariable" : "mdLink" }, { text: ` ${oneLine(task.title)}` }],
  });

  const header = (): Segment[][] => {
    const crew = getCrew();
    const c = crew.config;
    const statusTone: Tone = crew.status === "active" ? "success" : crew.status === "finished" ? "accent" : "warning";
    const total = spent(crew);
    const sep: Segment = { text: " · ", tone: "dim" };
    const same = ref(c.reviewerModel) === ref(c.workerModel);
    return [
      [{ text: "Crew", bold: true }, { text: " " }, { text: c.slug, tone: "accent", bold: true }, { text: " " }, { text: crew.status, tone: statusTone, bold: true }, sep, { text: oneLine(c.goal), tone: "mdHeading" }],
      [
        { text: c.integrationBranch, tone: "mdLink" }, sep,
        { text: `${runningTasks(crew).length}/${c.maxConcurrent}`, tone: "accent", bold: true }, { text: " running" }, sep,
        { text: money(total), tone: "syntaxString" }, { text: `/${money(c.budgetUsd)} ` }, { bar: c.budgetUsd > 0 ? total / c.budgetUsd : 1, cells: 10 },
      ],
      [{ text: "worker ", tone: "muted" }, { text: ref(c.workerModel), tone: "syntaxVariable" }, { text: " · reviewer ", tone: "muted" }, { text: same ? "same" : ref(c.reviewerModel), tone: same ? "muted" : "syntaxVariable" }],
    ];
  };

  const views: View<TaskRecord>[] = [
    { id: "overview", label: "Overview", render: (task, ctx) => overview(getCrew(), task, ctx.now, ctx.style) },
    { id: "spec", label: "Spec", render: (task) => ({ kind: "lines", lines: clean(task.spec).split("\n"), wrap: true }) },
    { id: "handoff", label: "Handoff", render: (task, ctx) => handoff(task, ctx.style) },
    { id: "checks", label: "Checks", render: (task, ctx) => checks(task, ctx.style) },
    {
      id: "diff", label: "Diff",
      render(task, ctx) {
        const crew = getCrew();
        const target = diffTarget(crew, task);
        if ("message" in target) return { kind: "message", text: target.message };
        return diffContent(task, diffs.get(task.id, crew.config.repoRoot, target.base, target.branch, ctx.changed), ctx.style);
      },
    },
    {
      id: "live", label: "Live", tail: true,
      render(task, ctx) {
        const streamed = deps.streamed(task);
        const view: TranscriptView = streamed ? { state: "ready", transcript: streamed, source: "live" }
          : !task.session ? { state: "unavailable", message: "No transcript: this task started before workers recorded sessions." }
          : sessions.get(task.session, ctx.changed);
        return liveContent(task, view);
      },
    },
  ];

  const actions: Action<TaskRecord>[] = [
    {
      id: "cancel", label: "cancel", key: "x", description: "cancel the selected running task",
      available: (task) => (task.status !== "running" ? `#${task.id} is not running`
        : !deps.live() ? "This crew isn't running in this session; nothing to cancel" : true),
      confirm: (task) => `Cancel #${task.id} "${oneLine(task.title)}"? Its worktree is kept.`,
      run(task) {
        // Not quiet: the planner should hear that the human stopped a task.
        return deps.cancel(task.id) ? { flash: `Cancelling #${task.id}; its handoff will wake the planner`, tone: "warning" }
          : { flash: `#${task.id} is no longer running`, tone: "dim" };
      },
    },
    {
      id: "open", label: "copy path", key: "o", description: "copy the worktree path",
      available: (task) => (task.worktree ? true : `#${task.id} has no worktree`),
      async run(task, ctx) {
        // Shown at once, so the path can be copied by hand if the clipboard is slow or missing.
        ctx.flash(task.worktree!, "accent");
        return { flash: await deps.copyPath(task.worktree!), tone: "accent" };
      },
    },
    {
      id: "export", label: "export", key: "e", description: "export the worker's session to HTML",
      available(task) {
        if (!task.session) return `#${task.id} has no session file: it started before sessions were recorded`;
        if (!deps.fileExists(task.session)) return `#${task.id} has no session file yet: the worker hasn't finished its first message`;
        if (deps.exporting.has(task.session)) return `#${task.id} is already being exported`;
        return true;
      },
      async run(task, ctx) {
        const session = task.session!;
        const output = session.replace(/\.jsonl$/, "") + ".html";
        deps.exporting.add(session);
        ctx.flash(`Exporting #${task.id}\u2026`);
        // A running worker's export is a snapshot of the messages it has finished.
        try {
          await deps.exportSession(session, output);
          return { flash: `Exported #${task.id} to ${output}`, tone: "success" };
        } catch (error) {
          return { flash: `Export of #${task.id} failed: ${(error as Error).message}`, tone: "error" };
        } finally {
          deps.exporting.delete(session);
        }
      },
    },
  ];

  return {
    name: "Tasks",
    empty: "No tasks yet",
    items() {
      const crew = getCrew();
      const at = now();
      return crew.tasks.map((t) => item(t, crew, at));
    },
    // All columns fit from a 48-column list (a 100-column panel); narrower lists drop kind, then cost, then activity.
    columns: [
      { id: "id" },
      { id: "kind", width: 4, drop: 3 },
      { id: "title", fill: 11 },
      { id: "time", width: 5, align: "right" },
      { id: "cost", width: 5, align: "right", drop: 2 },
      { id: "activity", fill: 9, drop: 1 },
    ],
    views,
    actions,
    header,
    dispose() {
      diffs = makeDiffs();
      sessions = makeSessions();
    },
  };
}

// ── Views ────────────────────────────────────────────────────────────────

function overview(crew: CrewState, task: TaskRecord, now: number, s: Style): Content {
  const rows: [string, string][] = [];
  const add = (label: string, value: string) => rows.push([label, value]);
  const hush = quiet(task, now, crew.config.stallMin);
  add("status", s.fg(STATUS_TONE[task.status], task.status) + (task.report?.handoff ? s.fg("dim", ` · handoff ${task.report.handoff.status}`) : ""));
  add("kind", kindOf(task));
  add("model", task.model);
  add("branch", task.branch ?? s.fg("dim", "none"));
  add("base", task.base ? task.base.slice(0, 12) : s.fg("dim", "none"));
  add("worktree", task.worktree ? tildify(task.worktree) : s.fg("dim", "removed"));
  add("session", task.session ? tildify(task.session) : s.fg("dim", "not recorded"));
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
  return {
    kind: "sections",
    parts: [
      { content: { kind: "fields", rows } },
      { content: { kind: "lines", lines: [s.fg("muted", "acceptance")] } },
      { content: { kind: "bullets", items: task.acceptance, empty: "none" } },
    ],
  };
}

const label = (text: string, s: Style): Content => ({ kind: "lines", lines: [s.fg("muted", text)] });

function handoff(task: TaskRecord, s: Style): Content {
  const r = task.report;
  if (!r) {
    return { kind: "message", text: task.status === "running" ? "Still running; the handoff arrives when the worker finishes." : `No handoff recorded (${task.status}).` };
  }
  const claims: Content[] = [];
  const h = r.handoff;
  if (h) {
    const rows: [string, string][] = [["status", h.status], ["summary", clean(h.summary) || s.fg("dim", "none")]];
    if (h.notes) rows.push(["notes", clean(h.notes)]);
    claims.push({ kind: "fields", rows });
    for (const [name, items] of [["concerns", h.concerns], ["deviations", h.deviations], ["findings", h.findings], ["next steps", h.next]] as const) {
      if (items.length) claims.push(label(name, s), { kind: "bullets", items });
    }
  } else {
    claims.push({ kind: "lines", lines: [s.fg("warning", `No parseable handoff: ${r.parseError ?? "worker did not finish"}`)] });
    if (r.partial) claims.push(label("last worker output", s), { kind: "lines", lines: clean(r.partial).split("\n").slice(-TAIL_LINES), wrap: true });
  }

  const observed: Content[] = [];
  const rows: [string, string][] = [["outcome", `${r.outcome} · ${duration(r.durationMs)} · ${money(r.cost)}`]];
  if (r.error) rows.push(["error", s.fg("error", clean(r.error))]);
  observed.push({ kind: "fields", rows });
  if (r.kind === "implement") {
    observed.push(label(`commits (${r.commits.length})`, s), { kind: "bullets", items: r.commits, empty: "none" });
    const stat = r.diffStat.trimEnd();
    if (stat) observed.push(label("diff --stat", s), { kind: "lines", lines: clean(stat).split("\n") });
    observed.push({ kind: "fields", rows: [["auto-commit", r.autoCommitted ? s.fg("warning", "yes: the worker left uncommitted changes") : "no"]] });
    observed.push(label("out of scope", s), { kind: "bullets", items: r.outOfScope, tone: "warning", empty: "none" });
  }
  if (r.dirtyAfterChecks?.length) {
    observed.push(label("dirty after checks (not on the branch)", s), { kind: "bullets", items: r.dirtyAfterChecks, tone: "warning" });
  } else if (r.checks.length) {
    observed.push({ kind: "fields", rows: [["after checks", "clean"]] });
  }

  return {
    kind: "sections",
    parts: [
      { title: "Worker's claims (unverified)", tone: "accent", content: { kind: "sections", parts: claims.map((content) => ({ content })) } },
      { title: "Observed by the harness", tone: "muted", content: { kind: "sections", parts: observed.map((content) => ({ content })) } },
    ],
  };
}

function verdict(c: CheckResult | undefined, task: TaskRecord, s: Style): string {
  if (!c) return s.fg("dim", task.status === "running" ? "PENDING" : "NOT RUN");
  if (c.timedOut) return s.fg("warning", "TIMEOUT");
  return c.exit === 0 ? s.fg("success", "PASS   ") : s.fg("error", `FAIL ${c.exit ?? "?"}`.padEnd(7));
}

const checkFailed = (c: CheckResult | undefined) => !!c && (c.timedOut || c.exit !== 0);

function checks(task: TaskRecord, s: Style): Content {
  if (!task.checks.length) {
    return { kind: "message", text: task.kind === "review" ? "Review tasks run no checks." : "No checks declared: the work is unverified." };
  }
  const dirty = task.report?.dirtyAfterChecks ?? [];
  const note = dirty.length
    ? [s.fg("warning", "The checks left uncommitted changes; passes may depend on them:"), ...dirty.map((f) => `${s.fg("dim", "- ")}${s.fg("warning", clean(f))}`)].join("\n")
    : undefined;
  return {
    kind: "collapsible",
    items: task.checks.map((command, i) => {
      const result = task.report?.checks[i];
      return {
        head: `${verdict(result, task, s)} ${clean(command)}`,
        // A check that hasn't run has no output to open.
        body: result ? clean(result.tail).trimEnd().split("\n") : undefined,
        open: checkFailed(result),
      };
    }),
    note,
  };
}

function diffContent(task: TaskRecord, view: DiffView, s: Style): Content {
  if (view.state === "loading") return { kind: "loading", text: "Loading diff…" };
  if (view.state === "unavailable") return { kind: "message", text: view.message, tone: "warning" };
  const note = task.reviewOf ? ` (task #${task.reviewOf}, under review)` : task.status === "running" ? " (commits so far; uncommitted edits not shown)" : "";
  const head = s.fg("dim", `git diff ${view.range}${note}`);
  if (!view.lines.length) return { kind: "lines", lines: [head, s.fg("dim", "No changes yet.")] };
  return { kind: "lines", lines: [head, ...view.lines], paint: "diff" };
}

function liveContent(task: TaskRecord, view: TranscriptView): Content {
  if (view.state === "loading") return { kind: "loading", text: "Loading the transcript…" };
  if (view.state === "unavailable") return { kind: "message", text: view.message };
  const note = view.source === "file" ? "from the session file, updated as messages finish"
    : task.status === "running" ? "streaming from the worker" : "as streamed in this session";
  return { kind: "transcript", note, dropped: view.transcript.dropped, entries: view.transcript.entries };
}

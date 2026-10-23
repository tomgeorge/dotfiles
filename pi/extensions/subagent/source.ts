import { duration, elapsedClock, money, oneLine, tildify, type Style, type Tone } from "../run-panel/format.ts";
import type { Content, Item, Source } from "../run-panel/source.ts";
import type { JobRecord, JobStatus, JobStore } from "./jobs.ts";
import { doing, elapsed, tokens } from "./panel.ts";

// Subagent jobs as a source for the shared panel (run-panel/): one item per job this session,
// Overview, Task, Activity, Live, and Result tabs, and a confirmed cancel. Layout and keys live in
// run-panel.

const STATUS_TONE: Record<JobStatus, Tone> = { running: "accent", ok: "success", error: "error", cancelled: "warning" };
/** Running jobs show the spinner instead. */
const STATUS_GLYPH: Record<Exclude<JobStatus, "running">, string> = { ok: "✓", error: "✗", cancelled: "⊘" };

const spent = (jobs: JobRecord[]) => jobs.reduce((sum, job) => sum + job.progress.usage.cost, 0);

function overview(job: JobRecord, now: number, s: Style): Content {
  const git = job.git === undefined ? s.fg("dim", "…") : job.git === null ? s.fg("dim", "not a git checkout")
    : s.fg("accent", job.git.branch) + (job.git.worktree ? s.fg("warning", " (worktree)") : "");
  const u = job.progress.usage;
  return {
    kind: "fields",
    rows: [
      ["cwd", tildify(job.cwd)],
      ["git", git],
      ["tools", job.tools.join(" ")],
      ["spend", `${money(u.cost)} ${s.fg("dim", `· ${tokens(u.input)} in / ${tokens(u.output)} out`)}`],
      ["calls", `${job.progress.toolCalls} ${s.fg("dim", `· ${doing(job)}`)}`],
      ["status", `${s.fg(STATUS_TONE[job.status], job.status)} ${s.fg("dim", `· ${duration(elapsed(job, now))}`)}`],
    ],
  };
}

function activity(job: JobRecord, s: Style): Content {
  if (!job.log.length) return { kind: "lines", lines: [s.fg("dim", "No tool calls yet")] };
  return { kind: "lines", lines: job.log.map((entry) => `${s.fg("dim", elapsedClock(entry.at))} ${oneLine(entry.text)}`) };
}

function live(job: JobRecord): Content {
  const { transcript } = job;
  if (!transcript.entries.length) return { kind: "message", text: job.status === "running" ? "Waiting for the first event…" : "Nothing was streamed" };
  const note = job.status === "running" ? "streaming from the subagent" : "as streamed in this session";
  return { kind: "transcript", note, dropped: transcript.dropped, entries: transcript.entries };
}

function result(job: JobRecord): Content {
  if (job.status === "running") return { kind: "message", text: "Still running; the result shows here when it finishes." };
  const parts: Extract<Content, { kind: "sections" }>["parts"] = [];
  if (job.error) parts.push({ content: { kind: "message", text: job.error, tone: "error" } });
  if (job.error && job.result) parts.push({ content: { kind: "lines", lines: [""] } });
  if (job.result) parts.push({ content: { kind: "markdown", text: job.result } });
  return parts.length ? { kind: "sections", parts } : { kind: "message", text: "No output" };
}

/** `cancel(id)` aborts the job's child process; false when it isn't running in this session. */
export function subagentSource(store: JobStore, cancel: (id: number) => boolean, now: () => number = Date.now): Source<JobRecord> {
  const item = (job: JobRecord, at: number): Item<JobRecord> => ({
    id: String(job.id),
    value: job,
    // A filter token matches within one field, so letters scattered across fields don't.
    text: [`#${job.id}`, `${job.provider}/${job.model}`, job.status, doing(job), job.task],
    cells: {
      id: { text: `#${job.id}`, tone: "accent" },
      model: { text: job.model, tone: "muted" },
      time: { text: duration(elapsed(job, at)), tone: "dim" },
      calls: { text: `${job.progress.toolCalls} tools`, tone: "dim" },
      cost: { text: money(job.progress.usage.cost), tone: "dim" },
      // As in the widget: a tool call in progress stands out; thinking and outcomes are dim.
      doing: job.status === "error" ? { text: oneLine(doing(job)), tone: "error" }
        : job.status === "running" && job.progress.phase === "tool" ? oneLine(doing(job))
        : { text: oneLine(doing(job)), tone: "dim" },
    },
    glyph: job.status === "running" ? undefined : { text: STATUS_GLYPH[job.status], tone: STATUS_TONE[job.status] },
    running: job.status === "running",
    title: [{ text: `#${job.id}`, tone: "accent" }, { text: ` ${job.model} ` }, { text: `· ${job.status}`, tone: "dim" }],
    // Follow a running job's conversation, then show what it found.
    defaultView: job.status === "running" ? "live" : "result",
  });

  return {
    name: "Subagents",
    empty: "No subagents yet",
    items() {
      const at = now();
      return store.list().map((job) => item(job, at));
    },
    status(matched, total) {
      const jobs = store.list();
      const count = matched === total ? `${total}` : `${matched}/${total}`;
      return `${count} · ${store.running().length} running · ${money(spent(jobs))}`;
    },
    columns: [
      { id: "id" },
      { id: "model", fill: 1 },
      { id: "time", align: "right" },
      { id: "calls", align: "right", drop: 2 },
      { id: "cost", align: "right", drop: 3 },
      { id: "doing", fill: 1, drop: 1 },
    ],
    views: [
      { id: "overview", label: "Overview", render: (job, ctx) => overview(job, ctx.now, ctx.style) },
      { id: "task", label: "Task", render: (job) => ({ kind: "markdown", text: job.task }) },
      { id: "activity", label: "Activity", tail: true, render: (job, ctx) => activity(job, ctx.style) },
      { id: "live", label: "Live", tail: true, render: (job) => live(job) },
      { id: "result", label: "Result", render: (job) => result(job) },
    ],
    actions: [
      {
        id: "cancel", label: "cancel", key: "x", description: "cancel the selected running subagent",
        available: (job) => (job.status === "running" ? true : `#${job.id} is not running`),
        confirm: (job) => `Cancel #${job.id} ${job.model}?`,
        run: (job) => (cancel(job.id)
          ? { flash: `Cancelling #${job.id}`, tone: "warning" }
          : { flash: `#${job.id} is not running`, tone: "warning" }),
      },
    ],
    subscribe: (onChange) => store.subscribe(onChange),
  };
}

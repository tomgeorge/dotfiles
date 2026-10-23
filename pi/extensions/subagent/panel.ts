import { duration, money, padStart, SPINNER, type Style } from "../run-panel/format.ts";
import type { JobRecord } from "./jobs.ts";

// Rendering for the below-editor widget and the tool row's progress line; /subagents is the
// shared panel (source.ts). Styling and terminal-width handling are injected (Pi's theme and
// pi-tui in production) so layout is testable without Pi.

export type { Style };

export const WIDGET_ROWS = 5;

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

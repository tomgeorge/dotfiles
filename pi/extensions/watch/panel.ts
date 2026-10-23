import { duration, padStart, SPINNER, type Style, type Tone } from "../run-panel/format.ts";
import { count, exitText } from "./report.ts";
import { END_MARK, endText, type WatchRecord } from "./store.ts";
import type { Watch } from "./watcher.ts";

// Rendering for the below-editor widget, and the wording it shares with the /watches panel
// (source.ts); the records come from store.ts. Styling is injected (Pi's theme and pi-tui in
// production) so layout is testable without Pi.

export const WIDGET_ROWS = 5;

// ── Formatting ───────────────────────────────────────────────────────────

export const kindLabel = (watch: Watch) => watch.kind === "prompt" ? "loop" : "watch";

/** What the watch is doing now, or how it ended. */
export function status(record: WatchRecord, now: number): string {
  const { watch } = record;
  if (record.ended) return endText(watch, record.ended);
  if (watch.state === "running") return "checking…";
  if (watch.state === "due") return "due when idle";
  return watch.nextAt ? `next in ${duration(watch.nextAt - now)}` : "waiting";
}

/** `3 checks` / `2 runs`. */
export const counter = (watch: Watch) => watch.kind === "prompt" ? count(watch.fires, "run") : count(watch.checks, "check");

/** The status mark; undefined while a check runs, which shows a spinner. */
export function mark(record: WatchRecord): { icon: string; tone: Tone } | undefined {
  if (record.ended) return END_MARK[record.ended.reason];
  switch (record.watch.state) {
    case "running": return undefined;
    case "due": return { icon: "●", tone: "warning" };
    default: return { icon: "◷", tone: "muted" };
  }
}

function icon(record: WatchRecord, frame: number, s: Style) {
  const m = mark(record);
  return m ? s.fg(m.tone, m.icon) : s.fg("accent", SPINNER[frame % SPINNER.length]);
}

/** A rule with a left title and optional right hint, e.g. `─ Watches ───── hint ─`. */
function rule(left: string, right: string, width: number, s: Style) {
  const head = `─ ${left} `;
  const tail = right ? ` ${right} ─` : "─";
  const fill = width - s.width(head) - s.width(tail);
  if (fill < 1) return s.truncate(s.fg("border", "─ ") + left, width);
  return s.fg("border", "─ ") + left + s.fg("border", ` ${"─".repeat(fill)}`) + (right ? ` ${s.fg("dim", right)} ${s.fg("border", "─")}` : s.fg("border", "─"));
}

/** `1 watching · 2 loops`, or `none active`. */
export function summary(records: WatchRecord[]) {
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

import { expandTabs, type Tone } from "../run-panel/format.ts";
import { exitText } from "./report.ts";
import { formatDuration, type EndReason, type RunResult, type Watch } from "./watcher.ts";

// Session record of every watch: an event log per watch, kept for the widget and the
// /watches panel after the Registry forgets an ended watch.

export const LOG_LIMIT = 200;
/** Ended watches kept for the panel; the oldest go first. */
export const ENDED_LIMIT = 50;

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
  private readonly records: WatchRecord[] = [];
  private readonly byWatch = new Map<Watch, WatchRecord>();
  private nextKey = 1;
  private readonly listeners = new Set<() => void>();

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
      this.logCheck(record, last, now);
      record.logged = last;
    }
    this.emit();
  }

  private logCheck(record: WatchRecord, result: RunResult, now: number) {
    // Whole output, as the Registry compares for `change`: the shown line alone can hide a change.
    const signature = `${exitText(result)}\n${result.stdout.trim()}\n${result.stderr.trim()}`;
    const prev = record.log.at(-1);
    if (prev?.signature === signature) {
      prev.repeat++;
      prev.at = now;
      return;
    }
    const line = summaryLine(result, record.logged);
    const text = `check · ${exitText(result)}${line ? ` · ${line}` : ""}`;
    const tone: Tone | undefined = result.code === 0 && !result.killed ? undefined : "dim";
    this.push(record, { at: now, text, tone, repeat: 1, signature });
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
    this.pruneEnded();
    this.emit();
  }

  /** Drop the oldest ended records beyond ENDED_LIMIT; active ones are never pruned. */
  private pruneEnded() {
    const ended = this.records.filter((r) => r.ended);
    for (const old of ended.slice(0, Math.max(0, ended.length - ENDED_LIMIT))) {
      this.records.splice(this.records.indexOf(old), 1);
      this.byWatch.delete(old.watch);
    }
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

/** How an ended watch shows in the list and its log. */
export const END_MARK: Record<EndReason, { tone: Tone; icon: string }> = {
  met: { tone: "success", icon: "✓" },
  error: { tone: "error", icon: "✗" },
  timeout: { tone: "warning", icon: "⊘" },
  stopped: { tone: "muted", icon: "⊘" },
};

export function endText(watch: Watch, ended: Ended): string {
  switch (ended.reason) {
    case "met": return "condition met";
    case "stopped": return "stopped";
    case "timeout": return `timed out after ${formatDuration(watch.timeoutMs)}`;
    case "error": return `error: ${ended.detail?.split("\n")[0] || "failed"}`;
  }
}

/** True while any check runs: the caller animates the spinner faster then. */
export const anyChecking = (records: WatchRecord[]) => records.some((r) => !r.ended && r.watch.state === "running");

import { formatDuration, oneLine, tail, type EndReason, type RunResult, type Watch } from "./watcher.ts";

// The text of reports, tool results and notifications, free of Pi so the
// wording is separate from how and when index.ts delivers it.

export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export const exitText = (result: RunResult) => result.killed ? "killed" : `exit ${result.code}`;

/** stdout, then stderr; empty when neither has output. */
export const outputText = (result: RunResult) =>
  [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");

function output(result: RunResult): string {
  const text = outputText(result);
  // Command output is data from outside the session, not instructions.
  return text ? `Command output (untrusted):\n${tail(text)}` : "(no output)";
}

/** ` (was exit 1)`, so a change report says what it changed from. */
const was = (watch: Watch) => watch.previous ? ` (was ${exitText(watch.previous)})` : "";

/** Log line for the panel when a command watch reports. */
export const firedNote = (watch: Watch) =>
  watch.until === "success" ? "reported: condition met" : `reported: changed${was(watch)}`;

export function fireReport(watch: Watch, result: RunResult, now: number): string {
  const verb = watch.until === "success" ? "condition met" : `output changed (change ${watch.fires})`;
  const lines = [
    `Watch #${watch.id} ${verb}: ${watch.description}`,
    `Command: ${watch.text}`,
    `Exit ${result.code}${watch.until === "change" ? was(watch) : ""} on check ${watch.checks}, ${formatDuration(now - watch.startedAt)} after starting.`,
  ];
  if (watch.until === "change") lines.push(`Still watching; stop it with watch_stop id ${watch.id}.`);
  lines.push("", output(result));
  return lines.join("\n");
}

/** "met" and "stopped" need no report: the first already fired, the second was asked for. */
export function endReport(watch: Watch, reason: Exclude<EndReason, "met" | "stopped">, detail?: string): string {
  const name = watch.kind === "prompt" ? "Loop" : "Watch";
  const lines = reason === "timeout"
    ? [`${name} #${watch.id} timed out after ${formatDuration(watch.timeoutMs)}${watch.kind === "command" && watch.until === "success" ? " without its condition being met" : ""}: ${watch.description}`]
    : [`${name} #${watch.id} stopped on an error: ${watch.description}`, detail ?? ""];
  if (watch.kind === "command") {
    lines.push(`Command: ${watch.text}`);
    if (watch.last) {
      const last = watch.last.killed ? "Last check was still running and was killed" : `Last exit ${watch.last.code}`;
      lines.push(`${last} after ${count(watch.checks, "check")}.`, "", output(watch.last));
    }
  }
  return lines.join("\n");
}

export const loopPrompt = (watch: Watch) =>
  `${watch.text}\n\n[Loop #${watch.id}, iteration ${watch.fires}, every ${formatDuration(watch.intervalMs)}. When this no longer needs checking, call watch_stop with id ${watch.id}.]`;

/** One line, so it also works as a select row. */
export function describe(watch: Watch, now: number): string {
  const parts = [`#${watch.id} ${watch.description}`];
  if (watch.kind === "prompt") parts.push("loop");
  else parts.push(`until ${watch.until}`, watch.deliver);
  parts.push(`every ${formatDuration(watch.intervalMs)}`, `${formatDuration(Math.max(0, watch.deadline - now))} left`);
  if (watch.kind === "prompt") parts.push(count(watch.fires, "run"));
  else {
    parts.push(count(watch.checks, "check"));
    if (watch.last) parts.push(`last ${exitText(watch.last)}`);
    if (watch.description !== oneLine(watch.text, 60)) parts.push(`$ ${oneLine(watch.text, 80)}`);
  }
  return parts.join(" · ");
}

const firstMeaning = (watch: Watch) => watch.until === "change"
  ? "this is the baseline; it reports when the output or exit code changes"
  : "not met yet; still watching";

/** `"pending"` while the first check is still running; `undefined` for loops or when none finished. */
export type FirstCheck = RunResult | undefined | "pending";

/** The first check for the `watch` tool result; empty for loops or when no check finished. */
export function firstCheckReport(watch: Watch, first: FirstCheck, waitedMs: number): string {
  if (watch.kind !== "command" || first === undefined) return "";
  if (first === "pending") return `First check still running after ${formatDuration(waitedMs)}; fine for a command that blocks until done.`;
  return [
    `First check: ${exitText(first)}; ${firstMeaning(watch)}.`,
    output(first),
    "If this output shows the check itself is broken (auth, typo, wrong path), stop it with watch_stop and start a corrected one.",
  ].join("\n");
}

/** The first check of a `/watch` command as a one-line notification. */
export function firstCheckNote(watch: Watch, first: RunResult): string {
  const err = first.code !== 0 ? oneLine(first.stderr, 120) : "";
  return `Watch #${watch.id} first check: ${exitText(first)}${err ? `: ${err}` : ""} · ${firstMeaning(watch)}`;
}

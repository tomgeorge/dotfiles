import { money } from "./state.ts";

// The handoff is the only thing that flows back up from a worker (Cursor's
// "self-driving codebases" design). Worker claims live in `handoff`; everything
// else in a TaskReport is observed by the harness, so the planner can tell them apart.

export type HandoffStatus = "done" | "partial" | "blocked";

export interface Handoff {
  status: HandoffStatus;
  summary: string;
  notes: string;
  concerns: string[];
  deviations: string[];
  findings: string[];
  next: string[];
}

export interface CheckResult {
  command: string;
  exit: number | null;
  /** Last lines of combined output. */
  tail: string;
  timedOut: boolean;
}

export type Outcome = "submitted" | "failed" | "cancelled" | "timeout";

export interface TaskReport {
  id: number;
  kind: "implement" | "review";
  title: string;
  outcome: Outcome;
  model: string;
  handoff?: Handoff;
  parseError?: string;
  branch?: string;
  base?: string;
  commits: string[];
  diffStat: string;
  /** Files changed outside the task's declared paths. */
  outOfScope: string[];
  /** Harness committed changes the worker left uncommitted. */
  autoCommitted: boolean;
  checks: CheckResult[];
  /** Files the harness checks modified or created; passes may depend on them. */
  dirtyAfterChecks?: string[];
  cost: number;
  durationMs: number;
  error?: string;
  /** Tail of the worker's text when it produced no parseable handoff. */
  partial?: string;
}

const STATUSES: HandoffStatus[] = ["done", "partial", "blocked"];

const strings = (value: unknown): string[] => {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).filter((s) => s.trim());
};

/** Parse the last ```handoff block in a worker's final text. */
export function parseHandoff(text: string): { handoff?: Handoff; error?: string } {
  const blocks = [...text.matchAll(/```handoff[^\n]*\n([\s\S]*?)```/g)];
  const last = blocks.at(-1);
  if (!last) return { error: "no ```handoff block in the worker's final message" };
  let raw: unknown;
  try {
    raw = JSON.parse(last[1]);
  } catch (error) {
    return { error: `handoff block is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "handoff must be a JSON object" };
  const o = raw as Record<string, unknown>;
  const status = STATUSES.includes(o.status as HandoffStatus) ? (o.status as HandoffStatus) : undefined;
  if (!status) return { error: `handoff status must be one of ${STATUSES.join(", ")}` };
  return {
    handoff: {
      status,
      summary: typeof o.summary === "string" ? o.summary : "",
      notes: typeof o.notes === "string" ? o.notes : strings(o.notes).join("\n"),
      concerns: strings(o.concerns),
      deviations: strings(o.deviations),
      findings: strings(o.findings),
      next: strings(o.next),
    },
  };
}

const list = (title: string, items: string[]) =>
  items.length ? [`${title}:`, ...items.map((item) => `- ${item}`)] : [];

/** Minutes to one decimal place. */
const minutes = (ms: number) => `${Math.round(ms / 6000) / 10}m`;

/** The last `lines` lines of a check's output, indented under its verdict. */
const indentedTail = (tail: string, lines = Infinity) =>
  tail.trimEnd().split("\n").slice(-lines).map((l) => `    ${l}`).join("\n");

/** `- exit 2: <command>` and its last `tailLines` lines of output, for each check that didn't pass. */
export const failedChecks = (checks: CheckResult[], tailLines: number): string[] =>
  checks.filter((c) => c.exit !== 0).map((c) => `- ${c.timedOut ? "timed out" : `exit ${c.exit}`}: ${c.command}\n${indentedTail(c.tail, tailLines)}`);

/** The follow-up message the planner receives. */
export function formatReport(r: TaskReport): string {
  const lines = [
    `Handoff from task #${r.id} (${r.kind}) "${r.title}": ${r.outcome.toUpperCase()}`,
    `model ${r.model} · ${minutes(r.durationMs)} · ${money(r.cost)}`,
  ];
  if (r.error) lines.push(`Error: ${r.error}`);
  lines.push("", "## Worker's handoff (claims)");
  if (r.handoff) {
    const h = r.handoff;
    lines.push(`status: ${h.status}`, `summary: ${h.summary || "(none)"}`);
    if (h.notes) lines.push(`notes: ${h.notes}`);
    lines.push(...list("concerns", h.concerns), ...list("deviations", h.deviations),
      ...list("findings", h.findings), ...list("suggested next", h.next));
  } else {
    lines.push(`(missing: ${r.parseError ?? "worker did not finish"})`);
    if (r.partial) lines.push("Last worker output:", r.partial);
  }
  if (r.kind === "review" && !r.checks.length) return lines.join("\n");
  lines.push("", "## Observed by the harness");
  if (r.kind === "implement") {
    lines.push(`branch: ${r.branch ?? "?"} (base ${r.base?.slice(0, 10) ?? "?"})`);
    lines.push(r.commits.length ? `commits:\n${r.commits.map((c) => `  ${c}`).join("\n")}` : "commits: none");
    if (r.autoCommitted) lines.push("note: worker left uncommitted changes; the harness committed them");
    lines.push(r.diffStat.trim() ? `diff --stat:\n${r.diffStat.trimEnd()}` : "diff: empty");
    if (r.outOfScope.length) lines.push(...list("changed OUTSIDE declared paths", r.outOfScope));
  }
  if (r.checks.length) {
    lines.push("checks:");
    for (const c of r.checks) {
      const verdict = c.timedOut ? "TIMED OUT" : c.exit === 0 ? "PASS" : `FAIL (exit ${c.exit})`;
      lines.push(`- ${verdict}: ${c.command}`);
      if (c.exit !== 0 && c.tail.trim()) lines.push(indentedTail(c.tail));
    }
  } else if (r.kind === "implement") {
    lines.push("checks: none declared (UNVERIFIED)");
  }
  if (r.dirtyAfterChecks?.length) {
    lines.push(...list("checks left uncommitted changes (not on the branch; passes may depend on them)", r.dirtyAfterChecks));
  }
  return lines.join("\n");
}

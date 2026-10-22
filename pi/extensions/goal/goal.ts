import { spawn } from "node:child_process";

// A goal is a completion contract (Codex "Goals"): an objective, a shell check
// that proves it, and a budget. The harness, not the model, decides "done":
// it runs the check whenever the agent settles and continues only while the
// check fails and the run is making progress.

export type GoalStatus = "active" | "paused" | "complete" | "parked" | "budget" | "cleared";

export interface CheckResult { exit: number | null; tail: string; timedOut: boolean; at: number }

export interface Goal {
  objective: string;
  check: string;
  status: GoalStatus;
  continuations: number;
  maxContinuations: number;
  startedAt: number;
  lastCheck?: CheckResult;
  /** Why the goal stopped without completing (parked or budget). */
  reason?: string;
}

export const DEFAULT_MAX_CONTINUATIONS = 20;

const STATUSES: readonly GoalStatus[] = ["active", "paused", "complete", "parked", "budget", "cleared"];

/** A goal read back from a session entry, or undefined if the entry isn't shaped like one. */
export function goalFromEntry(data: unknown): Goal | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const g = data as Record<string, unknown>;
  const ok = typeof g.objective === "string" && typeof g.check === "string" && STATUSES.includes(g.status as GoalStatus)
    && typeof g.continuations === "number" && typeof g.maxContinuations === "number";
  // Copy, so mutating the live goal never rewrites the entry it came from.
  return ok ? structuredClone(data as Goal) : undefined;
}

export function newGoal(objective: string, check: string, maxContinuations = DEFAULT_MAX_CONTINUATIONS, now = Date.now()): Goal {
  if (!objective.trim()) throw new Error("goal objective must not be empty");
  if (!check.trim()) throw new Error("goal needs a check command that exits 0 when the objective is met");
  if (!Number.isInteger(maxContinuations) || maxContinuations < 1) throw new Error("--max must be a positive integer");
  return { objective: objective.trim(), check: check.trim(), status: "active", continuations: 0, maxContinuations, startedAt: now };
}

export type ParsedCommand =
  | { kind: "status" | "pause" | "resume" | "clear" }
  | { kind: "set"; objective: string; check?: string; max?: number };

/** `/goal <objective> [--check <command>] [--max N]`, or a lifecycle word. --check takes the rest of the line. */
export function parseGoalArgs(raw: string): ParsedCommand {
  const text = raw.trim();
  if (!text || text === "status") return { kind: "status" };
  if (text === "pause" || text === "resume" || text === "clear") return { kind: text };
  let rest = text;
  let max: number | undefined;
  // A trailing --max is ours even after --check; a check that needs its own trailing
  // --max can be wrapped in quotes or a script.
  rest = rest.replace(/\s--max\s+(\S+)\s*$/, (_m, n: string) => {
    max = Number(n);
    return "";
  });
  let check: string | undefined;
  const checkAt = rest.search(/(^|\s)--check(\s|$)/);
  if (checkAt >= 0) {
    check = rest.slice(checkAt).replace(/^\s*--check\s*/, "").trim() || undefined;
    rest = rest.slice(0, checkAt);
  }
  rest = rest.replace(/(^|\s)--max\s+(\S+)/, (_m, lead: string, n: string) => {
    max = Number(n);
    return lead;
  });
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) throw new Error("--max must be a positive integer");
  return { kind: "set", objective: rest.trim(), check, max };
}

export type Decision =
  | { action: "none" }
  | { action: "complete" }
  | { action: "continue" }
  /** Stop without completing; `status` is the goal's new status. */
  | { action: "stop"; status: "paused" | "parked" | "budget"; reason: string };

/** What to do after an agent run settles, given the check result. Pure. */
export function decide(goal: Goal, run: { checkPassed: boolean; toolCalls: number; aborted: boolean; errored?: boolean }): Decision {
  if (goal.status !== "active") return { action: "none" };
  if (run.aborted) return { action: "stop", status: "paused", reason: "you interrupted the run" };
  if (run.errored && !run.checkPassed) return { action: "stop", status: "paused", reason: "the run ended with an error (for example a provider or rate-limit failure)" };
  if (run.checkPassed) return { action: "complete" };
  // A run that touched nothing can't have moved the check; repeating it just spins.
  if (run.toolCalls === 0) return { action: "stop", status: "parked", reason: "the last run made no tool calls, so it wasn't making progress" };
  if (goal.continuations >= goal.maxContinuations) {
    return { action: "stop", status: "budget", reason: `used all ${goal.maxContinuations} automatic continuations` };
  }
  return { action: "continue" };
}

// These ride on goal_park's promptGuidelines, which Pi includes whenever the tool is active.
// A before_agent_start section would miss the runs the goal itself starts: Pi doesn't emit
// before_agent_start for sendMessage({ triggerTurn }).
export const GOAL_GUIDELINES = [
  "An active goal is attached to this session. Its objective and check arrive in goal messages. It is done only when the harness runs the check and it exits 0.",
  "Work toward making the goal's check pass legitimately. Never weaken, skip, or edit the check or the tests it runs to make them pass.",
  "You don't decide when the goal is done. The harness runs the check after each of your runs and continues you automatically if it fails.",
  "Each run toward the goal should make concrete progress: change code, run commands, or test a hypothesis. A run with no tool calls stops the goal.",
  "If you're blocked on something only the user can provide (a decision, credentials, scope), call goal_park with what you need instead of guessing.",
];

/**
 * The message that starts (or restarts) work on a goal. It repeats the rules, because Pi
 * applies the newly active goal_park's guidelines only from the run's second request.
 */
export function startMessage(goal: Goal, verb: "set" | "resumed"): string {
  return `Goal ${verb}: ${goal.objective}
Done when \`${goal.check}\` exits 0, run by the harness in the session's working directory. Budget: ${goal.continuations}/${goal.maxContinuations} automatic continuations used.

${GOAL_GUIDELINES.slice(1).map((g) => `- ${g}`).join("\n")}

Start working.`;
}

export function continuationMessage(goal: Goal): string {
  const c = goal.lastCheck;
  const result = !c ? "did not run" : c.timedOut ? "timed out" : `exited ${c.exit}`;
  return `Goal not met yet (continuation ${goal.continuations}/${goal.maxContinuations}). The check \`${goal.check}\` ${result}:
${c?.tail.trimEnd() || "(no output)"}

Objective: ${goal.objective}
Pick the next step that moves the check toward passing. If you're blocked on the user, call goal_park.`;
}

export function statusLine(goal: Goal | undefined): string {
  if (!goal || goal.status === "cleared") return "No goal. Set one with /goal <objective> --check <command>";
  const c = goal.lastCheck;
  const last = c ? `last check ${c.timedOut ? "timed out" : `exit ${c.exit}`}` : "not checked yet";
  return `Goal [${goal.status}] ${goal.objective}\ncheck: ${goal.check}\n${goal.continuations}/${goal.maxContinuations} continuations · ${last}${goal.reason ? `\nreason: ${goal.reason}` : ""}`;
}

/** Run the check in its own process group; keep only the tail. */
export function runCheck(cwd: string, command: string, timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    let timedOut = false;
    let done = false;
    let drain: NodeJS.Timeout | undefined;
    const keep = (chunk: Buffer) => { out = (out + chunk.toString("utf8")).slice(-16_384); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const killGroup = () => {
      if (child.pid === undefined) return; // never spawned
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* the group already exited */ }
    };
    const finish = (exit: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(drain);
      // Background jobs the check left behind would pile up across runs.
      killGroup();
      // A daemon that left the process group can hold the pipes open forever; stop reading.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ exit, tail: out.split("\n").slice(-40).join("\n"), timedOut, at: Date.now() });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      finish(null);
    }, timeoutMs);
    child.on("error", (error) => { out += error.message; finish(null); });
    // "close" waits for every pipe holder; after the shell exits, give output a moment to drain.
    child.on("exit", (code) => { clearTimeout(timer); drain = setTimeout(() => finish(code), 500); });
    child.on("close", (code) => finish(code));
  });
}

import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
// Extension tool from git-read.ts, loaded into the child only when requested.
export const GIT_TOOL = "git";
export const ALLOWED_TOOLS = [...READ_TOOLS, GIT_TOOL] as const;
export const GIT_EXTENSION = fileURLToPath(new URL("./git-read.ts", import.meta.url));
// Children run with --no-extensions; these are loaded explicitly anyway.
// pi-anthropic-auth keeps Anthropic subscription auth on plan limits; without it,
// Anthropic rejects requests with a 400 ("Third-party apps now draw from your extra usage").
export const CHILD_EXTENSIONS = ["npm:@gotgenes/pi-anthropic-auth"] as const;
export interface Job {
  task: string;
  provider: string;
  model: string;
  cwd: string;
  tools: string[];
}
export interface Result {
  status: "ok" | "error" | "cancelled";
  text: string;
  error: string | null;
}

export interface Usage {
  /** Prompt tokens including cache reads/writes, summed over turns. */
  input: number;
  output: number;
  /** Provider-reported USD. */
  cost: number;
}

export type Phase = "starting" | "thinking" | "writing" | "tool";

export interface Progress {
  toolCalls: number;
  /** Latest child tool call, e.g. `grep "foo"`. */
  activity: string;
  phase: Phase;
  usage: Usage;
}

const ZERO_USAGE: Usage = { input: 0, output: 0, cost: 0 };
const DEFAULT_TIMEOUT_MS = 1_200_000; // 20 minutes: deep reviews outrun 5
const SIGKILL_AFTER_MS = 1000;
// Bound a broken child's unterminated event; normal events can be large.
const MAX_EVENT_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL = 8192;
const ACTIVITY_MAX = 80;
const INVALID_EVENT = "Invalid JSON event from subagent";

/** Fields of a JSON value from the child; non-objects have none, as with `?.` access. */
function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function readUsage(raw: unknown): Usage {
  const u = fields(raw);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const cost = fields(u.cost);
  return { input: n(u.input) + n(u.cacheRead) + n(u.cacheWrite), output: n(u.output), cost: n(cost.total) };
}

/** Joined text parts of an assistant message; `undefined` when content isn't a list of parts. */
function messageText(content: unknown): string | undefined {
  if (content === undefined || content === null) return "";
  // A null part is rejected so the event counts as invalid rather than silently
  // skipping the part. Other non-object parts are skipped.
  if (!Array.isArray(content) || content.includes(null)) return undefined;
  return content.filter((part) => fields(part).type === "text").map((part) => fields(part).text).join("\n");
}

const addUsage = (a: Usage, b: Usage): Usage =>
  ({ input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost });

function describeToolCall(name: unknown, args: unknown): string {
  const a = fields(args);
  const detail = a.path ?? a.pattern ?? a.query ?? a.args ?? "";
  const shown = typeof detail === "string" ? detail
    : Array.isArray(detail) ? detail.join(" ") : JSON.stringify(detail);
  const text = `${name} ${shown}`.trim();
  return text.length > ACTIVITY_MAX ? `${text.slice(0, ACTIVITY_MAX - 3)}...` : text;
}

/** Folds the child's JSON events into live progress and the final assistant message. */
class ChildEvents {
  readonly progress: Progress = { toolCalls: 0, activity: "starting", phase: "starting", usage: ZERO_USAGE };
  text = "";
  stopReason = "";
  modelError = "";
  // message_update usage is cumulative for the in-flight response only.
  private finishedUsage = ZERO_USAGE;
  private readonly job: Job;

  constructor(job: Job) {
    this.job = job;
  }

  /** `changed` when `progress` should be reported; `stop` with a reason when the child must be killed. */
  apply(event: Record<string, unknown>): { changed: boolean; stop?: string } {
    const { progress } = this;
    if (event.type === "tool_execution_start") {
      progress.toolCalls++;
      progress.activity = describeToolCall(event.toolName, event.args);
      progress.phase = "tool";
      return { changed: true };
    }
    if (event.type === "message_update") {
      const kind = fields(event.assistantMessageEvent).type;
      if (kind === "thinking_start") progress.phase = "thinking";
      else if (kind === "text_start") progress.phase = "writing";
      if (event.usage) progress.usage = addUsage(this.finishedUsage, readUsage(event.usage));
      return { changed: true };
    }
    const message = fields(event.message);
    if (event.type !== "message_end" || message.role !== "assistant") return { changed: false };
    this.finishedUsage = addUsage(this.finishedUsage, readUsage(message.usage));
    progress.usage = this.finishedUsage;
    // Refuse a child which resolved the requested model differently.
    if (message.provider !== this.job.provider || message.model !== this.job.model) {
      return { changed: true, stop: "Child used a different provider/model than requested" };
    }
    const text = messageText(message.content);
    if (text === undefined) return { changed: true, stop: INVALID_EVENT };
    this.text = text;
    this.stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
    this.modelError = typeof message.errorMessage === "string" ? message.errorMessage : "";
    return { changed: true };
  }
}

export function validateJob(job: Job): void {
  for (const key of ["task", "provider", "model", "cwd"] as const) {
    if (!job[key]?.trim()) throw new Error(`${key} must not be empty`);
  }
  if (!isAbsolute(job.cwd)) throw new Error("cwd must be an absolute path");
  if (!job.tools.length || job.tools.some((tool) => !ALLOWED_TOOLS.includes(tool as typeof ALLOWED_TOOLS[number]))) {
    throw new Error(`tools must be a nonempty subset of: ${ALLOWED_TOOLS.join(", ")}`);
  }
}

export function buildArgs(job: Job, extensions: readonly string[] = CHILD_EXTENSIONS): string[] {
  validateJob(job);
  const all = job.tools.includes(GIT_TOOL) ? [...extensions, GIT_EXTENSION] : extensions;
  return [
    "-p", "--mode", "json", "--no-session", "--no-extensions",
    ...all.flatMap((source) => ["-e", source]),
    "--no-skills", "--no-prompt-templates", "--no-approve", "--offline",
    "--provider", job.provider, "--model", job.model,
    "--tools", job.tools.join(","),
    // Prefix prevents task text being interpreted as a CLI option or @file.
    `Task: ${job.task}`,
  ];
}

/** One process, one job. No conversation history, scheduling, or model routing. */
export async function runSubagent(
  job: Job,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: (progress: Progress) => void;
    /** Every parsed event from the child, for the panel's Live transcript. */
    onEvent?: (event: Record<string, unknown>) => void;
    // Injection point for tests; production uses pi from PATH.
    command?: string;
    prefixArgs?: string[];
  } = {},
): Promise<Result> {
  const args = buildArgs(job);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive");
  if (options.signal?.aborted) return { status: "cancelled", text: "", error: "Subagent cancelled" };

  return new Promise((resolve) => {
    const child = spawn(options.command ?? "pi", [...(options.prefixArgs ?? []), ...args], {
      cwd: job.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
    const events = new ChildEvents(job);
    let buffer = "";
    let stderr = "";
    let failure: string | null = null;
    let cancelled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = (reason: string, abort = false) => {
      if (failure) return;
      failure = reason;
      cancelled = abort;
      child.kill("SIGTERM");
      // `child.killed` only means a signal was sent, not that it exited.
      killTimer = setTimeout(() => child.kill("SIGKILL"), SIGKILL_AFTER_MS);
    };
    const abort = () => stop("Subagent cancelled", true);
    const timer = setTimeout(() => stop(`Subagent timed out after ${timeoutMs} ms`), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    const processLine = (line: string) => {
      if (!line.trim() || failure) return;
      let outcome: ReturnType<ChildEvents["apply"]>;
      let event: Record<string, unknown>;
      try {
        // Inside the guard: a hostile event (e.g. tool args with `toString: null`) can throw while
        // being applied, and a throw in this stream handler would crash the parent.
        event = fields(JSON.parse(line));
        outcome = events.apply(event);
      } catch {
        return stop(INVALID_EVENT);
      }
      try {
        options.onEvent?.(event);
      } catch {
        // A display bug must not kill the child or lose its result.
      }
      if (outcome.stop) stop(outcome.stop);
      // Outside the guard so a UI callback bug isn't reported as bad JSON.
      if (outcome.changed) options.onProgress?.({ ...events.progress });
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (buffer.length > MAX_EVENT_BYTES) {
        buffer = "";
        stop(`Subagent JSON event exceeded ${MAX_EVENT_BYTES / 1024 / 1024} MiB`);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_TAIL); });
    child.on("error", (error) => { failure = error.message; });
    child.on("close", (code, signal) => {
      if (buffer.trim()) processLine(buffer);
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      const { text, stopReason, modelError } = events;
      if (failure) return resolve({ status: cancelled ? "cancelled" : "error", text, error: failure });
      if (code !== 0 || stopReason !== "stop" || !text.trim()) {
        return resolve({
          status: stopReason === "aborted" ? "cancelled" : "error", text,
          error: modelError || stderr.trim() || `Subagent did not complete (exit ${code}, signal ${signal}, stop ${stopReason || "missing"})`,
        });
      }
      resolve({ status: "ok", text, error: null });
    });
  });
}

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

export interface Progress {
  toolCalls: number;
  /** Latest child tool call, e.g. `grep "foo"`. */
  activity: string;
}

function describeToolCall(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const detail = a.path ?? a.pattern ?? a.query ?? a.args ?? "";
  const shown = typeof detail === "string" ? detail
    : Array.isArray(detail) ? detail.join(" ") : JSON.stringify(detail);
  const text = `${name} ${shown}`.trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
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
    // Injection point for tests; production uses pi from PATH.
    command?: string;
    prefixArgs?: string[];
  } = {},
): Promise<Result> {
  const args = buildArgs(job);
  const timeoutMs = options.timeoutMs ?? 1_200_000; // 20 minutes: deep reviews outrun 5
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive");
  if (options.signal?.aborted) return { status: "cancelled", text: "", error: "Subagent cancelled" };

  return new Promise((resolve) => {
    const child = spawn(options.command ?? "pi", [...(options.prefixArgs ?? []), ...args], {
      cwd: job.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    let stderr = "";
    let text = "";
    let stopReason = "";
    let modelError = "";
    let failure: string | null = null;
    let cancelled = false;
    const progress: Progress = { toolCalls: 0, activity: "starting" };
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = (reason: string, abort = false) => {
      if (failure) return;
      failure = reason;
      cancelled = abort;
      child.kill("SIGTERM");
      // `child.killed` only means a signal was sent, not that it exited.
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const abort = () => stop("Subagent cancelled", true);
    const timer = setTimeout(() => stop(`Subagent timed out after ${timeoutMs} ms`), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    const processLine = (line: string) => {
      if (!line.trim() || failure) return;
      let reportProgress = false;
      try {
        const event = JSON.parse(line);
        if (event?.type === "tool_execution_start") {
          progress.toolCalls++;
          progress.activity = describeToolCall(event.toolName, event.args);
          reportProgress = true;
          return;
        }
        const message = event?.message;
        if (event?.type !== "message_end" || message?.role !== "assistant") return;
        // Refuse a child which resolved the requested model differently.
        if (message.provider !== job.provider || message.model !== job.model) {
          stop("Child used a different provider/model than requested");
          return;
        }
        text = (message.content ?? [])
          .filter((part: { type: string }) => part.type === "text")
          .map((part: { text: string }) => part.text).join("\n");
        stopReason = message.stopReason;
        modelError = message.errorMessage ?? "";
      } catch {
        stop("Invalid JSON event from subagent");
      } finally {
        // Outside the parse guard so a UI callback bug isn't reported as bad JSON.
        if (reportProgress) options.onProgress?.({ ...progress });
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      // Bound a broken child's unterminated event; normal events can be large.
      if (buffer.length > 8 * 1024 * 1024) {
        buffer = "";
        stop("Subagent JSON event exceeded 8 MiB");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });
    child.on("error", (error) => { failure = error.message; });
    child.on("close", (code, signal) => {
      if (buffer.trim()) processLine(buffer);
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
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

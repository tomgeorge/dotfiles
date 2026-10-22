import { spawn } from "node:child_process";

export interface WorkerJob {
  provider: string;
  model: string;
  cwd: string;
  tools: string[];
  prompt: string;
  /** Extension sources loaded into the child with `-e`. */
  extensions: string[];
  env?: Record<string, string>;
}

export interface Usage { input: number; output: number; cost: number }

export interface WorkerProgress {
  toolCalls: number;
  activity: string;
  phase: "starting" | "thinking" | "writing" | "tool";
  usage: Usage;
  /** Time of the last stream event of ANY kind. Thinking deltas count: a watchdog that
   * only heard content tokens killed healthy reasoning children (yaah#309). */
  lastEventAt: number;
}

export interface WorkerResult {
  status: "ok" | "error" | "cancelled" | "timeout";
  /** Final assistant text when the child finished; otherwise the latest text it produced. */
  text: string;
  error: string | null;
  progress: WorkerProgress;
}

const ZERO: Usage = { input: 0, output: 0, cost: 0 };

function readUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const cost = (u.cost ?? {}) as Record<string, unknown>;
  return { input: n(u.input) + n(u.cacheRead) + n(u.cacheWrite), output: n(u.output), cost: n(cost.total) };
}

const add = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost });

function describe(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const detail = a.path ?? a.command ?? a.pattern ?? a.query ?? "";
  const text = `${name} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export function buildWorkerArgs(job: WorkerJob): string[] {
  for (const key of ["provider", "model", "cwd", "prompt"] as const) {
    if (!job[key]?.trim()) throw new Error(`${key} must not be empty`);
  }
  if (!job.tools.length) throw new Error("tools must not be empty");
  return [
    "-p", "--mode", "json", "--no-session", "--no-extensions",
    ...job.extensions.flatMap((source) => ["-e", source]),
    "--no-skills", "--no-prompt-templates", "--no-approve", "--offline",
    "--provider", job.provider, "--model", job.model,
    "--tools", job.tools.join(","),
    // Prefix keeps the prompt from being parsed as an option or @file.
    `Task: ${job.prompt}`,
  ];
}

/** One worker process. Never throws; every ending is a WorkerResult. */
export function runWorker(
  job: WorkerJob,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    onProgress?: (progress: WorkerProgress) => void;
    command?: string;
    prefixArgs?: string[];
  },
): Promise<WorkerResult> {
  const progress: WorkerProgress = { toolCalls: 0, activity: "starting", phase: "starting", usage: ZERO, lastEventAt: Date.now() };
  let args: string[];
  try {
    args = buildWorkerArgs(job);
  } catch (error) {
    return Promise.resolve({ status: "error", text: "", error: (error as Error).message, progress });
  }
  if (options.signal?.aborted) return Promise.resolve({ status: "cancelled", text: "", error: "cancelled", progress });

  return new Promise((resolve) => {
    const child = spawn(options.command ?? "pi", [...(options.prefixArgs ?? []), ...args], {
      cwd: job.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: true,
      env: { ...process.env, ...job.env },
    });
    let buffer = "";
    let stderr = "";
    let finalText = "";
    let lastText = "";
    let streaming = "";
    let stopReason = "";
    let modelError = "";
    let ending: { status: WorkerResult["status"]; error: string } | undefined;
    let finished = ZERO;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    // Kill the process group so bash/test grandchildren die with the worker.
    // The child leads its group (detached), but it can leave it (setsid/setpgid), so when the
    // group looks gone and the child hasn't exited, signal the child directly.
    // Takes the ending to annotate so it needn't re-check the shared `ending` variable.
    const signalGroup = (sig: NodeJS.Signals, end: { error: string }) => {
      if (child.pid === undefined) return; // never spawned; its error event ends the run
      // A worker we can't stop must not crash Pi; say so in its result instead.
      const report = (error: unknown) => { end.error += `; could not send ${sig} to the worker: ${(error as Error).message}`; };
      // Gone: ESRCH, or EPERM, which macOS returns when the group's remaining members are exiting or zombies.
      const gone = (error: unknown) => {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "ESRCH" || code === "EPERM";
      };
      try {
        process.kill(-child.pid, sig);
      } catch (error) {
        if (!gone(error)) return report(error);
        if (child.exitCode !== null || child.signalCode !== null) return;
        try { child.kill(sig); } catch (childError) { if (!gone(childError)) report(childError); }
      }
    };
    const stop = (status: WorkerResult["status"], error: string) => {
      if (ending) return;
      const end = { status, error };
      ending = end;
      signalGroup("SIGTERM", end);
      killTimer = setTimeout(() => signalGroup("SIGKILL", end), 2000);
    };
    const abort = () => stop("cancelled", "cancelled");
    const timer = setTimeout(() => stop("timeout", `timed out after ${Math.round(options.timeoutMs / 60000)} min`), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });

    // A live output tail for the crew panel would keep a bounded ring of these events here.
    const handle = (line: string) => {
      if (!line.trim()) return;
      progress.lastEventAt = Date.now();
      let event: Record<string, any>;
      try {
        event = JSON.parse(line);
      } catch {
        return; // Non-JSON noise must not kill a worker that may be mid-task.
      }
      if (event.type === "tool_execution_start") {
        progress.toolCalls++;
        progress.activity = describe(event.toolName, event.args);
        progress.phase = "tool";
      } else if (event.type === "message_update") {
        const update = event.assistantMessageEvent ?? {};
        if (update.type === "thinking_start" || update.type === "thinking_delta") progress.phase = "thinking";
        if (update.type === "text_start") { progress.phase = "writing"; streaming = ""; }
        if (update.type === "text_delta" && typeof update.delta === "string") streaming = (streaming + update.delta).slice(-16_384);
        if (event.usage) progress.usage = add(finished, readUsage(event.usage));
      } else if (event.type === "message_end" && event.message?.role === "assistant") {
        const message = event.message;
        finished = add(finished, readUsage(message.usage));
        progress.usage = finished;
        if (message.provider !== job.provider || message.model !== job.model) {
          stop("error", `child used ${message.provider}/${message.model}, not the requested ${job.provider}/${job.model}`);
          return;
        }
        const text = (message.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
        if (text.trim()) lastText = text;
        finalText = text;
        streaming = "";
        stopReason = message.stopReason ?? "";
        modelError = message.errorMessage ?? "";
      }
      options.onProgress?.({ ...progress });
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      if (buffer.length > 8 * 1024 * 1024) { buffer = ""; stop("error", "worker JSON event exceeded 8 MiB"); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });
    child.on("error", (error) => { ending ??= { status: "error", error: error.message }; });
    child.on("close", (code, sig) => {
      if (buffer.trim()) handle(buffer);
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      // Keep whatever the worker said last; a killed worker's partial output is evidence.
      const partial = [lastText, streaming].filter((s) => s.trim()).join("\n").slice(-8192);
      if (ending) return resolve({ status: ending.status, text: partial, error: ending.error, progress });
      if (code !== 0 || stopReason !== "stop" || !finalText.trim()) {
        return resolve({
          status: stopReason === "aborted" ? "cancelled" : "error", text: partial, progress,
          error: modelError || stderr.trim() || `worker did not complete (exit ${code}, signal ${sig}, stop ${stopReason || "missing"})`,
        });
      }
      resolve({ status: "ok", text: finalText, error: null, progress });
    });
  });
}

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, type AgentToolUpdateCallback, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ALLOWED_TOOLS, runSubagent, validateJob, type Job, type Progress } from "./runner.ts";

const DEFAULT_MAX_CONCURRENT = 5;
const MAX_CONCURRENT_FLAG = "subagent-max-concurrent";
const MAX_CONCURRENT_ENV = "PI_SUBAGENT_MAX_CONCURRENT";

export default function (pi: ExtensionAPI) {
  const active = new Map<number, { controller: AbortController; done: Promise<unknown> }>();
  let nextId = 1;
  let shuttingDown = false;

  pi.registerFlag(MAX_CONCURRENT_FLAG, {
    description: `Maximum concurrent subagent jobs (default ${DEFAULT_MAX_CONCURRENT}; env ${MAX_CONCURRENT_ENV})`,
    type: "string",
  });

  // Read lazily: CLI flags aren't available while the extension factory runs.
  function maxConcurrent(): number {
    const flag = pi.getFlag(MAX_CONCURRENT_FLAG);
    const raw = typeof flag === "string" && flag !== "" ? flag : process.env[MAX_CONCURRENT_ENV];
    if (raw === undefined || raw === "") return DEFAULT_MAX_CONCURRENT;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Subagent concurrency limit must be a positive integer, got "${raw}"`);
    }
    return limit;
  }

  function checkCapacity() {
    const limit = maxConcurrent();
    if (active.size >= limit) {
      throw new Error(`${active.size} subagents already running (limit ${limit}). Wait or use /subagent-cancel.`);
    }
  }

  async function run(job: Job, ctx: ExtensionContext, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback) {
    if (shuttingDown) throw new Error("Session is shutting down");
    checkCapacity();
    validateJob(job);
    const available = ctx.modelRegistry.getAvailable();
    if (!available.some((model) => model.provider === job.provider && model.id === job.model)) {
      throw new Error(`Unavailable model: ${job.provider}/${job.model}. Use /subagent to pick an exact model.`);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const id = nextId++;
    const statusKey = `subagent-${id}`;
    const started = Date.now();
    let progress: Progress = { toolCalls: 0, activity: "starting" };
    const report = () => {
      const secs = Math.round((Date.now() - started) / 1000);
      const line = `Subagent #${id} ${job.provider}/${job.model} · ${secs}s · ${progress.toolCalls} tool calls · ${progress.activity}`;
      if (ctx.hasUI) ctx.ui.setStatus(statusKey, line);
      onUpdate?.({ content: [{ type: "text", text: line }], details: undefined });
    };
    const done = runSubagent(job, {
      signal: controller.signal,
      onProgress: (p) => { progress = p; report(); },
    });
    active.set(id, { controller, done });
    report();
    // Tick so elapsed time moves during long model calls with no tool activity.
    const ticker = setInterval(report, 1000);
    try {
      const result = await done;
      if (result.status !== "ok") throw new Error(`Subagent #${id} ${result.status}: ${result.error}`);
      const truncated = truncateHead(result.text);
      let text = truncated.content;
      if (truncated.truncated) {
        const dir = await mkdtemp(join(tmpdir(), "pi-subagent-"));
        const file = join(dir, "result.txt");
        await writeFile(file, result.text, { mode: 0o600 });
        text += `\n\n[Output truncated to 2000 lines / 50 KiB. Full output: ${file}]`;
      }
      return {
        content: [{ type: "text" as const, text }],
        details: { id, status: result.status, provider: job.provider, model: job.model, cwd: job.cwd },
      };
    } finally {
      clearInterval(ticker);
      signal?.removeEventListener("abort", abort);
      active.delete(id);
      if (ctx.hasUI) ctx.ui.setStatus(statusKey, undefined);
    }
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run one read-only task in a fresh pi process. Explicit provider/model, absolute cwd, and tools; no parent conversation is copied. Only read, grep, find, ls, and git (read-only subcommands: log, show, diff, blame, grep, merge-base, rev-parse, branch/tag listing, etc.) are allowed. Several calls may run in parallel, up to a per-session concurrency limit (default 5); each has a 20-minute timeout. Output capped at 2000 lines / 50 KiB with full output saved to a temporary file when truncated. Extensions and skills are disabled in the child; extension-only providers are unsupported.",
    promptGuidelines: ["Use subagent only when the user requests or approves delegation. Include all necessary task context and use the user's chosen provider/model."],
    parameters: Type.Object({
      task: Type.String({ minLength: 1 }),
      provider: Type.String({ minLength: 1 }),
      model: Type.String({ minLength: 1, description: "Exact model ID, not an alias or pattern" }),
      cwd: Type.String({ minLength: 1, description: "Absolute working directory" }),
      tools: Type.Array(StringEnum([...ALLOWED_TOOLS]), { minItems: 1, uniqueItems: true }),
    }),
    // Independent child processes share no mutable state beyond the job map.
    executionMode: "parallel",
    async execute(_id, job, signal, onUpdate, ctx) {
      return run(job, ctx, signal, onUpdate);
    },
  });

  pi.registerCommand("subagent", {
    description: "Read-only job: /subagent provider/model task (no arguments opens a picker)",
    async handler(args, ctx) {
      const fail = (error: unknown) => {
        if (shuttingDown) return;
        const text = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(text, "error");
        else throw error;
      };
      try {
        // Fail before the picker rather than after the user has typed a task.
        checkCapacity();
        let modelName: string | undefined;
        let task: string | undefined;
        if (args.trim()) {
          const match = args.trim().match(/^(\S+)\s+([\s\S]+)$/);
          if (!match) throw new Error("Usage: /subagent provider/model task; or /subagent for a picker");
          [, modelName, task] = match;
        } else {
          if (!ctx.hasUI) throw new Error("Specify provider/model and task in non-interactive mode");
          const models = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`).sort();
          if (!models.length) throw new Error("No available models. Configure Pi authentication first.");
          modelName = await ctx.ui.select("Subagent model", models);
          if (!modelName) return;
          task = await ctx.ui.editor("Subagent task (read-only)");
          if (!task?.trim()) return;
        }
        const slash = modelName.indexOf("/");
        if (slash < 1) throw new Error("Use an exact provider/model ID");
        const job: Job = {
          provider: modelName.slice(0, slash), model: modelName.slice(slash + 1),
          task, cwd: ctx.cwd, tools: [...ALLOWED_TOOLS],
        };
        const pending = run(job, ctx);
        const deliver = (result: Awaited<typeof pending>) => {
          if (!shuttingDown) pi.sendMessage({
            customType: "subagent-result", display: true,
            content: `Subagent #${result.details.id} ${modelName}\nTask: ${task}\n\n${result.content[0].text}`,
            details: result.details,
          }, { deliverAs: "followUp" });
        };
        // Pi awaits command handlers and blocks input meanwhile, so interactive jobs
        // run in the background. Print mode must wait or the process exits first.
        if (!ctx.hasUI) return deliver(await pending);
        pending.then(deliver, fail);
      } catch (error) {
        fail(error);
      }
    },
  });

  pi.registerCommand("subagent-cancel", {
    description: "Cancel subagents: /subagent-cancel [id] (no id cancels all)",
    async handler(args, ctx) {
      const notify = (text: string, level: "info" | "error") => {
        if (ctx.hasUI) ctx.ui.notify(text, level);
        else if (level === "error") throw new Error(text);
      };
      const arg = args.trim().replace(/^#/, "");
      if (!arg) {
        if (!active.size) return notify("No subagent is running", "info");
        for (const { controller } of active.values()) controller.abort();
        return;
      }
      const job = active.get(Number(arg));
      if (!job) {
        const running = [...active.keys()].map((id) => `#${id}`).join(", ") || "none";
        return notify(`No running subagent #${arg} (running: ${running})`, "error");
      }
      job.controller.abort();
    },
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    const jobs = [...active.values()];
    for (const { controller } of jobs) controller.abort();
    await Promise.all(jobs.map(({ done }) => done));
  });
}

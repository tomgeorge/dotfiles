import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { READ_TOOLS, runSubagent, validateJob, type Job } from "./runner.ts";

export default function (pi: ExtensionAPI) {
  let active: { controller: AbortController; done: Promise<unknown> } | undefined;
  let shuttingDown = false;

  async function run(job: Job, ctx: ExtensionContext, signal?: AbortSignal) {
    if (shuttingDown) throw new Error("Session is shutting down");
    if (active) throw new Error("A subagent is already running. Wait or use /subagent-cancel.");
    validateJob(job);
    const available = ctx.modelRegistry.getAvailable();
    if (!available.some((model) => model.provider === job.provider && model.id === job.model)) {
      throw new Error(`Unavailable model: ${job.provider}/${job.model}. Use /subagent to pick an exact model.`);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const done = runSubagent(job, { signal: controller.signal });
    active = { controller, done };
    if (ctx.hasUI) ctx.ui.setStatus("subagent", `Subagent: ${job.provider}/${job.model}`);
    try {
      const result = await done;
      if (result.status !== "ok") throw new Error(`${result.status}: ${result.error}`);
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
        details: { status: result.status, provider: job.provider, model: job.model, cwd: job.cwd },
      };
    } finally {
      signal?.removeEventListener("abort", abort);
      active = undefined;
      if (ctx.hasUI) ctx.ui.setStatus("subagent", undefined);
    }
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run one read-only task in a fresh pi process. Explicit provider/model, absolute cwd, and tools; no parent conversation is copied. Only read, grep, find, ls are allowed. One outstanding job per session, five-minute timeout. Output capped at 2000 lines / 50 KiB with full output saved to a temporary file when truncated. Extensions and skills are disabled in the child; extension-only providers are unsupported.",
    promptGuidelines: ["Use subagent only when the user requests or approves delegation. Include all necessary task context and use the user's chosen provider/model."],
    parameters: Type.Object({
      task: Type.String({ minLength: 1 }),
      provider: Type.String({ minLength: 1 }),
      model: Type.String({ minLength: 1, description: "Exact model ID, not an alias or pattern" }),
      cwd: Type.String({ minLength: 1, description: "Absolute working directory" }),
      tools: Type.Array(StringEnum([...READ_TOOLS]), { minItems: 1, uniqueItems: true }),
    }),
    async execute(_id, job, signal, _onUpdate, ctx) {
      return run(job, ctx, signal);
    },
  });

  pi.registerCommand("subagent", {
    description: "Read-only job: /subagent provider/model task (no arguments opens a picker)",
    async handler(args, ctx) {
      try {
        if (active) throw new Error("A subagent is already running. Wait or use /subagent-cancel.");
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
          task, cwd: ctx.cwd, tools: [...READ_TOOLS],
        };
        const result = await run(job, ctx);
        if (!shuttingDown) pi.sendMessage({
          customType: "subagent-result", display: true,
          content: `Subagent ${modelName}\nTask: ${task}\n\n${result.content[0].text}`,
          details: result.details,
        }, { deliverAs: "followUp" });
      } catch (error) {
        if (shuttingDown) return;
        const text = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(text, "error");
        else throw error;
      }
    },
  });

  pi.registerCommand("subagent-cancel", {
    description: "Cancel the running subagent",
    async handler(_args, ctx) {
      if (active) active.controller.abort();
      else if (ctx.hasUI) ctx.ui.notify("No subagent is running", "info");
    },
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    active?.controller.abort();
    await active?.done;
  });
}

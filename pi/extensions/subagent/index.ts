import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatElapsed, JobRegistry, LABEL_PATTERN, parseMaxConcurrent, type Entry } from "./registry.ts";
import { READ_TOOLS, runSubagent, validateJob, type Job } from "./runner.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_MS = 100;

export default function (pi: ExtensionAPI) {
  const config = parseMaxConcurrent(process.env.PI_SUBAGENT_MAX_CONCURRENT);
  const registry = new JobRegistry(config.max);
  const running = new Set<Promise<unknown>>();
  let shuttingDown = false;
  let widgetShown = false;

  function refreshUI(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const count = registry.size;
    ctx.ui.setStatus("subagent", count ? `Subagents: ${count} running` : undefined);
    if (!count) {
      if (widgetShown) ctx.ui.setWidget("subagent", undefined);
      widgetShown = false;
      return;
    }
    if (widgetShown) return;
    widgetShown = true;
    // The component reads the registry on every render, so it only needs a
    // timer to animate; Pi calls dispose() when the widget is cleared.
    ctx.ui.setWidget("subagent", (tui, theme) => {
      const timer = setInterval(() => tui.requestRender(), SPINNER_MS);
      return {
        render(width: number) {
          const now = Date.now();
          const frame = SPINNER[Math.floor(now / SPINNER_MS) % SPINNER.length];
          return registry.list().map((entry) => truncateToWidth(
            `${theme.fg("accent", frame)} ${entry.label}  ${theme.fg("dim", `#${entry.id}  ${entry.model}`)}  ${formatElapsed(now - entry.startedAt)}`,
            width,
          ));
        },
        invalidate() {},
        dispose() { clearInterval(timer); },
      };
    });
  }

  async function run(job: Job, label: string | undefined, ctx: ExtensionContext, signal?: AbortSignal) {
    if (shuttingDown) throw new Error("Session is shutting down");
    validateJob(job);
    const modelName = `${job.provider}/${job.model}`;
    const available = ctx.modelRegistry.getAvailable();
    if (!available.some((model) => model.provider === job.provider && model.id === job.model)) {
      throw new Error(`Unavailable model: ${modelName}. Use /subagent to pick an exact model.`);
    }
    const controller = new AbortController();
    // No await between registry.add and here (see JobRegistry.add).
    const entry: Entry = registry.add(label, modelName, controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const done = runSubagent(job, { signal: controller.signal });
    running.add(done);
    refreshUI(ctx);
    const name = `${entry.label} (#${entry.id})`;
    try {
      const result = await done;
      if (result.status !== "ok") throw new Error(`${result.status}: ${name}: ${result.error}`);
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
        details: {
          status: result.status, id: entry.id, label: entry.label,
          provider: job.provider, model: job.model, cwd: job.cwd,
        },
      };
    } finally {
      signal?.removeEventListener("abort", abort);
      running.delete(done);
      registry.remove(entry.id);
      if (!shuttingDown) refreshUI(ctx);
    }
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: `Run one read-only task in a fresh pi process. Explicit provider/model, absolute cwd, and tools; no parent conversation is copied. Only read, grep, find, ls are allowed. Up to ${config.max} concurrent jobs per session (PI_SUBAGENT_MAX_CONCURRENT); more fail rather than queue. Put independent tasks in separate subagent calls in the same turn so they run in parallel. Give each job a short, descriptive label that is unique among running jobs; the user sees it and can cancel by it. Five-minute timeout per job. Output capped at 2000 lines / 50 KiB with full output saved to a temporary file when truncated. Extensions and skills are disabled in the child; extension-only providers are unsupported.`,
    promptGuidelines: ["Use subagent only when the user requests or approves delegation. Include all necessary task context and use the user's chosen provider/model."],
    parameters: Type.Object({
      label: Type.String({
        pattern: LABEL_PATTERN, minLength: 1, maxLength: 64,
        description: "Short unique name for this job, shown to the user and used to cancel it, e.g. auth-review. Lowercase letters, digits, hyphens; not \"all\" or only digits.",
      }),
      task: Type.String({ minLength: 1 }),
      provider: Type.String({ minLength: 1 }),
      model: Type.String({ minLength: 1, description: "Exact model ID, not an alias or pattern" }),
      cwd: Type.String({ minLength: 1, description: "Absolute working directory" }),
      tools: Type.Array(StringEnum([...READ_TOOLS]), { minItems: 1, uniqueItems: true }),
    }),
    async execute(_id, { label, ...job }, signal, _onUpdate, ctx) {
      return run(job, label, ctx, signal);
    },
  });

  pi.registerCommand("subagent", {
    description: "Read-only job: /subagent provider/model task (no arguments opens a picker)",
    async handler(args, ctx) {
      try {
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
        const result = await run(job, undefined, ctx);
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
    description: "Cancel subagents: /subagent-cancel <label|number|all> (no argument: pick, or cancel the only one)",
    getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
      const items = [
        { value: "all", label: "all", description: "Cancel every running subagent" },
        ...registry.list().map((e) => ({ value: e.label, label: e.label, description: `#${e.id} ${e.model}` })),
      ].filter((item) => item.value.startsWith(prefix.trim()));
      return items.length ? items : null;
    },
    async handler(args, ctx) {
      const notify = (text: string, level: "info" | "error") => {
        if (ctx.hasUI) ctx.ui.notify(text, level);
        else if (level === "error") throw new Error(text);
      };
      const entries = registry.list();
      if (!entries.length) return notify("No subagent is running", "info");
      let ref = args.trim();
      if (!ref) {
        if (entries.length === 1) ref = String(entries[0].id);
        else if (!ctx.hasUI) ref = "all";
        else {
          const options = ["all", ...entries.map((e) => `${e.label}  #${e.id}  ${e.model}`)];
          const choice = await ctx.ui.select("Cancel subagent", options);
          if (!choice) return;
          ref = choice === "all" ? "all" : String(entries[options.indexOf(choice) - 1].id);
        }
      }
      if (ref === "all") {
        registry.cancelAll();
        return notify(`Cancelling ${entries.length} subagent(s)`, "info");
      }
      const entry = registry.cancel(ref);
      if (!entry) return notify(`No running subagent matches "${ref}"`, "error");
      notify(`Cancelling ${entry.label} (#${entry.id})`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (config.warning && ctx.hasUI) ctx.ui.notify(config.warning, "warning");
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    shuttingDown = true;
    registry.cancelAll();
    await Promise.allSettled([...running]);
    if (ctx.hasUI && widgetShown) {
      ctx.ui.setWidget("subagent", undefined);
      ctx.ui.setStatus("subagent", undefined);
    }
    widgetShown = false;
  });
}

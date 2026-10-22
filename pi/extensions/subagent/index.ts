import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { getMarkdownTheme, truncateHead, type AgentToolUpdateCallback, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type KeyId, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { JobStore, readGitInfo } from "./jobs.ts";
import { glowRenderer } from "./markdown.ts";
import {
  doing, duration, initialPopup, money, popupKey, popupLines, widgetLines,
  type PopupKey, type PopupState, type Style,
} from "./panel.ts";
import { pickModel, type PickerUI } from "./picker.ts";
import { ALLOWED_TOOLS, runSubagent, validateJob, type Job, type Progress } from "./runner.ts";

const DEFAULT_MAX_CONCURRENT = 5;
const MAX_CONCURRENT_FLAG = "subagent-max-concurrent";
const MAX_CONCURRENT_ENV = "PI_SUBAGENT_MAX_CONCURRENT";
const PANEL_KEY = "ctrl+shift+s";
const WIDGET_KEY = "subagents";
const SPINNER_MS = 120;

// glow when installed; otherwise Pi's own markdown component.
const renderMarkdown = glowRenderer((text, width) => new Markdown(text, 0, 0, getMarkdownTheme()).render(width));

function makeStyle(theme: Theme): Style {
  return {
    fg: (tone, text) => theme.fg(tone, text),
    bold: (text) => theme.bold(text),
    selected: (text) => theme.bg("selectedBg", text),
    width: visibleWidth,
    truncate: (text, width, pad) => truncateToWidth(text, Math.max(0, width), "…", pad),
    wrap: (text, width) => wrapTextWithAnsi(text, Math.max(1, width)),
    markdown: (text, width) => renderMarkdown(text, Math.max(1, width)),
  };
}

// First match wins; letters mirror lazygit/vim.
const POPUP_KEYS: [KeyId[], PopupKey][] = [
  [["up", "k"], "up"],
  [["down", "j"], "down"],
  [["pageUp", "ctrl+u"], "pageUp"],
  [["pageDown", "ctrl+d"], "pageDown"],
  [["home", "g"], "top"],
  [["end", "shift+g"], "bottom"],
  [["enter", "tab", "l", "right"], "enter"],
  [["escape", "h", "left"], "back"],
  [["a"], "toggle"],
  [["t"], "task"],
  [["x"], "cancel"],
  [["q", "ctrl+c", PANEL_KEY], "close"],
];

export default function (pi: ExtensionAPI) {
  const active = new Map<number, { controller: AbortController; done: Promise<unknown> }>();
  let nextId = 1;
  let shuttingDown = false;
  // One model picker at a time: parallel tool calls would otherwise stack dialogs.
  let pickerQueue: Promise<unknown> = Promise.resolve();
  // Every job this session, finished ones included, for the widget and popup.
  const store = new JobStore();
  let frame = 0;
  let spinner: ReturnType<typeof setInterval> | undefined;
  let widgetTui: TUI | undefined;
  let widgetCtx: ExtensionContext | undefined;
  let popupOpen = false;

  /** Show the below-editor widget while jobs run; animate its spinner. */
  function syncWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const running = store.running().length > 0;
    if (running && !widgetCtx) {
      widgetCtx = ctx;
      ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
        widgetTui = tui;
        const component: Component = {
          render: (width) => widgetLines(store.list(), Date.now(), width, makeStyle(theme), { frame, hint: PANEL_KEY }),
          invalidate() {},
        };
        return component;
      }, { placement: "belowEditor" });
      spinner = setInterval(() => { frame++; widgetTui?.requestRender(); }, SPINNER_MS);
    } else if (!running && widgetCtx) {
      clearInterval(spinner);
      spinner = undefined;
      widgetCtx.ui.setWidget(WIDGET_KEY, undefined);
      widgetCtx = undefined;
      widgetTui = undefined;
    }
  }

  async function openPopup(ctx: ExtensionContext) {
    if (!ctx.hasUI || popupOpen) return;
    popupOpen = true;
    try {
      await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
        const state: PopupState = initialPopup(store.list());
        let page = 1;
        const unsubscribe = store.subscribe(() => tui.requestRender());
        // The widget's spinner stops when nothing runs; tick here too so elapsed
        // time moves for jobs started while only the popup is up.
        const ticker = setInterval(() => tui.requestRender(), SPINNER_MS);
        return {
          render(width) {
            const height = Math.max(8, Math.floor(tui.terminal.rows * 0.8));
            const out = popupLines(store.list(), state, Date.now(), width, height, makeStyle(theme), frame);
            page = out.page;
            return out.lines;
          },
          handleInput(data) {
            const key = POPUP_KEYS.find(([ids]) => ids.some((id) => matchesKey(data, id)))?.[1]
              ?? (data === "G" ? "bottom" : undefined);
            if (!key) return;
            const action = popupKey(state, store.list(), key, page);
            if (action.type === "close") return done();
            if (action.type === "cancel") active.get(action.id)?.controller.abort();
            tui.requestRender();
          },
          invalidate() {},
          dispose() {
            unsubscribe();
            clearInterval(ticker);
          },
        };
      }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", minWidth: 60, maxHeight: "80%" } });
    } finally {
      popupOpen = false;
    }
  }

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

  function pickerUI(ctx: ExtensionContext): PickerUI {
    return {
      select: (title, options, opts) => ctx.ui.select(title, options, opts),
      status: (text) => ctx.ui.setStatus("subagent-route", text),
      warn: (text) => ctx.ui.notify(text, "warning"),
    };
  }

  /** The user confirms a model from locally ranked suggestions. `undefined` if they cancel. */
  function confirmModel(task: string, ctx: ExtensionContext, via: "command" | "tool", signal?: AbortSignal) {
    const next = pickerQueue.then(() => {
      if (signal?.aborted) return undefined;
      // Recheck here: jobs may have started while this call waited for the picker.
      checkCapacity();
      return pickModel(task, pickerUI(ctx), ctx.modelRegistry.getAvailable(), { signal, via });
    });
    pickerQueue = next.catch(() => {});
    return next;
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
    const started = Date.now();
    const record = store.add({
      id, provider: job.provider, model: job.model, task: job.task, cwd: job.cwd, tools: job.tools, started,
      progress: { toolCalls: 0, activity: "starting", phase: "starting", usage: { input: 0, output: 0, cost: 0 } },
    });
    readGitInfo(job.cwd).then((git) => store.setGit(id, git));
    // The tool row streams one line; the widget and popup read the store.
    const report = () => {
      const { progress } = record;
      const line = `Subagent #${id} ${job.model} · ${duration(Date.now() - started)} · ${progress.toolCalls} tool calls · ${money(progress.usage.cost)} · ${doing(record)}`;
      onUpdate?.({ content: [{ type: "text", text: line }], details: undefined });
    };
    const done = runSubagent(job, {
      signal: controller.signal,
      onProgress: (p: Progress) => store.update(id, p),
    });
    active.set(id, { controller, done });
    syncWidget(ctx);
    report();
    // Tick so elapsed time moves during long model calls with no tool activity.
    const ticker = setInterval(report, 1000);
    let finished = false;
    try {
      const result = await done;
      store.finish(id, result.status, { result: result.text || undefined, error: result.error ?? undefined });
      finished = true;
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
    } catch (error) {
      if (!finished) store.finish(id, "error", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      clearInterval(ticker);
      signal?.removeEventListener("abort", abort);
      active.delete(id);
      syncWidget(ctx);
    }
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run one read-only task in a fresh pi process. Absolute cwd and tools; no parent conversation is copied. Give an exact provider/model when the user named one; otherwise omit both and the user picks from locally ranked suggestions before the job starts. Only read, grep, find, ls, and git (read-only subcommands: log, show, diff, blame, grep, merge-base, rev-parse, branch/tag listing, etc.) are allowed. Several calls may run in parallel, up to a per-session concurrency limit (default 5); each has a 20-minute timeout. Output capped at 2000 lines / 50 KiB with full output saved to a temporary file when truncated. Extensions and skills are disabled in the child; extension-only providers are unsupported.",
    promptGuidelines: ["Use subagent only when the user requests or approves delegation. Include all necessary task context. Use the provider/model the user chose; if they didn't choose one, omit provider and model so they can pick. Never guess a model."],
    parameters: Type.Object({
      task: Type.String({ minLength: 1 }),
      provider: Type.Optional(Type.String({ minLength: 1, description: "Omit with model to let the user pick" })),
      model: Type.Optional(Type.String({ minLength: 1, description: "Exact model ID, not an alias or pattern" })),
      cwd: Type.String({ minLength: 1, description: "Absolute working directory" }),
      tools: Type.Array(StringEnum([...ALLOWED_TOOLS]), { minItems: 1, uniqueItems: true }),
    }),
    // Independent child processes share no mutable state beyond the job map.
    executionMode: "parallel",
    async execute(_id, params, signal, onUpdate, ctx) {
      let { provider, model } = params;
      if ((provider === undefined) !== (model === undefined)) {
        throw new Error("Give both provider and model, or neither to let the user pick");
      }
      if (provider === undefined || model === undefined) {
        if (!ctx.hasUI) throw new Error("provider and model are required without an interactive UI");
        checkCapacity();
        const picked = await confirmModel(params.task, ctx, "tool", signal);
        if (!picked) throw new Error("The user didn't choose a model; the subagent was not started");
        ({ provider, model } = picked);
      }
      return run({ ...params, provider, model }, ctx, signal, onUpdate);
    },
  });

  pi.registerCommand("subagent", {
    description: "Read-only job: /subagent [provider/model] task (without a model, pick from ranked suggestions)",
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
        const available = ctx.modelRegistry.getAvailable();
        const providers = new Set(available.map((m) => m.provider));
        let modelName: string | undefined;
        let task: string | undefined;
        const [, first = "", rest = ""] = args.trim().match(/^(\S+)\s*([\s\S]*)$/) ?? [];
        const slash = first.indexOf("/");
        if (slash > 0 && available.some((m) => `${m.provider}/${m.id}` === first)) {
          modelName = first;
          task = rest;
          if (!task.trim()) throw new Error("Usage: /subagent [provider/model] task");
        } else if (slash > 0 && providers.has(first.slice(0, slash))) {
          // Looks like a model for a known provider: a typo, not the start of a task.
          throw new Error(`Unavailable model: ${first}. Use /subagent without a model to pick one.`);
        } else {
          if (!ctx.hasUI) throw new Error("Specify provider/model and task in non-interactive mode");
          task = args.trim() || await ctx.ui.editor("Subagent task (read-only)");
          if (!task?.trim()) return;
          const picked = await confirmModel(task, ctx, "command");
          if (!picked) return;
          modelName = `${picked.provider}/${picked.model}`;
        }
        const cut = modelName.indexOf("/");
        const job: Job = {
          provider: modelName.slice(0, cut), model: modelName.slice(cut + 1),
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

  pi.registerCommand("subagents", {
    description: `Browse subagents: status, activity, spend, results (${PANEL_KEY})`,
    handler: (_args, ctx) => openPopup(ctx),
  });

  pi.registerShortcut(PANEL_KEY, {
    description: "Browse subagents",
    handler: (ctx) => openPopup(ctx),
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    clearInterval(spinner);
    const jobs = [...active.values()];
    for (const { controller } of jobs) controller.abort();
    await Promise.all(jobs.map(({ done }) => done));
  });
}

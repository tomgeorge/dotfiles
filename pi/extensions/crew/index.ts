import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  addWorktree, branchFacts, commitAll, commonDirOf, diffText, GIT_ENV, gitOk, mergeBranch, outsidePaths,
  removeWorktree, repoInfo, runCheck, worktreePath,
} from "./git.ts";
import { formatReport, parseHandoff, type TaskReport } from "./handoff.ts";
import { plannerPrompt, reviewerPrompt, workerPrompt } from "./prompts.ts";
import {
  formatStatus, listCrews, runningTasks, saveState, slugify, spent,
  type CrewState, type ModelRef, type TaskRecord,
} from "./state.ts";
import { runWorker, type WorkerJob, type WorkerResult } from "./worker.ts";

// Same reason as the subagent extension: keeps Anthropic subscription auth working
// in children started with --no-extensions.
const CHILD_EXTENSIONS = ["npm:@gotgenes/pi-anthropic-auth"];
const GUARD = fileURLToPath(new URL("./guard.ts", import.meta.url));
const WRITE_TOOLS = ["read", "grep", "find", "ls", "edit", "write", "bash"];
const READ_TOOLS = ["read", "grep", "find", "ls"];
const CREW_TOOLS = ["crew_dispatch", "crew_integrate", "crew_status", "crew_cancel", "crew_wake", "crew_finish"];
const CHECK_TIMEOUT_MS = 10 * 60_000;
const SWEEP_MS = 30_000;
const RENDER_MS = 1_000;
const REVIEW_DIFF_BYTES = 60_000;
const DEFAULTS = { maxConcurrent: 3, budgetUsd: 10, taskTimeoutMin: 45, stallMin: 10 };

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
const ref = (m: ModelRef) => `${m.provider}/${m.model}`;

export default function (pi: ExtensionAPI) {
  let crew: CrewState | undefined;
  let ui: ExtensionContext | undefined;
  let toolsBefore: string[] | undefined;
  let shuttingDown = false;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  let renderTimer: ReturnType<typeof setInterval> | undefined;
  const controllers = new Map<number, AbortController>();
  const quietCancels = new Set<number>();
  const wakeTimers = new Set<ReturnType<typeof setTimeout>>();
  const pending = new Set<Promise<void>>();

  const isActive = () => crew?.status === "active";

  function warn(message: string) {
    if (ui?.hasUI) ui.ui.notify(message, "warning");
  }

  function persist() {
    if (!crew) return;
    try {
      saveState(crew);
    } catch (error) {
      warn(`crew: could not save state: ${(error as Error).message}`);
    }
  }

  /** Deliver to the planner. `wake` starts a planner turn if it is idle. */
  function tell(customType: string, content: string, wake: boolean) {
    if (shuttingDown) return;
    pi.sendMessage({ customType, content, display: true }, { deliverAs: "followUp", triggerTurn: wake && isActive() });
  }

  function render() {
    if (!ui?.hasUI) return;
    if (!crew || !isActive()) {
      ui.ui.setWidget("crew", undefined);
      ui.ui.setStatus("crew", undefined);
      return;
    }
    const now = Date.now();
    const running = runningTasks(crew);
    const lines = [`crew ${crew.config.slug} · ${running.length}/${crew.config.maxConcurrent} running · $${spent(crew).toFixed(2)}/$${crew.config.budgetUsd.toFixed(2)} · /crew-status`];
    for (const t of running) {
      const secs = Math.round((now - t.startedAt) / 1000);
      const quiet = Math.round((now - t.lastEventAt) / 1000);
      lines.push(` #${t.id} ${t.kind.padEnd(9)} ${String(Math.floor(secs / 60)).padStart(3)}m${String(secs % 60).padStart(2, "0")}s  ${String(t.toolCalls).padStart(3)} tools  $${t.cost.toFixed(2)}  ${quiet > 60 ? `(quiet ${quiet}s) ` : ""}${t.activity}`.slice(0, 160));
    }
    ui.ui.setWidget("crew", lines, { placement: "belowEditor" });
    ui.ui.setStatus("crew", `crew: ${running.length} running`);
  }

  function sweep() {
    if (!crew || !isActive()) return;
    const now = Date.now();
    for (const t of runningTasks(crew)) {
      const quietMin = (now - t.lastEventAt) / 60_000;
      if (!t.stallReported && quietMin >= crew.config.stallMin) {
        t.stallReported = true;
        tell("crew-stall", `Possible stall: task #${t.id} "${t.title}" has emitted no stream events at all (not even thinking) for ${Math.floor(quietMin)} min. Last activity: ${t.activity}. A long build or test can be legitimately quiet. Decide whether to wait, crew_cancel it and re-dispatch with a tighter spec, or escalate.`, true);
      }
    }
    if (!crew.budgetReported && spent(crew) >= crew.config.budgetUsd) {
      crew.budgetReported = true;
      tell("crew-budget", `Budget reached: $${spent(crew).toFixed(2)} of $${crew.config.budgetUsd.toFixed(2)}. New dispatches are refused; running workers continue. Finish with what's integrated or escalate for more budget.`, true);
    }
    persist();
  }

  function activate() {
    toolsBefore ??= pi.getActiveTools().filter((t) => !CREW_TOOLS.includes(t));
    // The planner gets read tools and crew tools only. Cursor's executor broke down
    // when it also edited, merged, and judged.
    pi.setActiveTools([...READ_TOOLS, ...CREW_TOOLS]);
    clearInterval(sweepTimer);
    clearInterval(renderTimer);
    sweepTimer = setInterval(sweep, SWEEP_MS);
    if (ui?.hasUI) renderTimer = setInterval(render, RENDER_MS);
    render();
  }

  function deactivate() {
    pi.setActiveTools(toolsBefore ?? pi.getActiveTools().filter((t) => !CREW_TOOLS.includes(t)));
    toolsBefore = undefined;
    clearInterval(sweepTimer);
    clearInterval(renderTimer);
    sweepTimer = renderTimer = undefined;
    for (const timer of wakeTimers) clearTimeout(timer);
    wakeTimers.clear();
    render();
  }

  function requireCrew(): CrewState {
    if (!crew || !isActive()) throw new Error("No active crew. The human starts one with /crew <goal>.");
    return crew;
  }

  async function buildReport(task: TaskRecord, result: WorkerResult, signal: AbortSignal): Promise<TaskReport> {
    const outcome = result.status === "ok" ? "submitted" : result.status === "error" ? "failed" : result.status;
    const parsed = parseHandoff(result.text);
    const report: TaskReport = {
      id: task.id, kind: task.kind, title: task.title, outcome, model: task.model,
      handoff: parsed.handoff, parseError: parsed.error, branch: task.branch, base: task.base,
      commits: [], diffStat: "", outOfScope: [], autoCommitted: false, checks: [],
      cost: result.progress.usage.cost, durationMs: Date.now() - task.startedAt,
      error: result.error ?? undefined,
      partial: parsed.handoff ? undefined : result.text.slice(-3000) || undefined,
    };
    if (task.kind !== "implement" || !task.worktree || !task.base) return report;
    try {
      report.autoCommitted = await commitAll(task.worktree, `crew: uncommitted changes left by task #${task.id}`);
      const facts = await branchFacts(task.worktree, task.base);
      report.commits = facts.commits;
      report.diffStat = facts.diffStat;
      report.outOfScope = outsidePaths(facts.files, task.paths);
    } catch (error) {
      report.error = [report.error, `harness: ${(error as Error).message}`].filter(Boolean).join("; ");
    }
    // Checks are the harness's own evidence, so run them even when the worker timed out.
    if (outcome !== "cancelled" && !shuttingDown) {
      for (const command of task.checks) {
        if (signal.aborted) break;
        report.checks.push(await runCheck(task.worktree, command, CHECK_TIMEOUT_MS, signal));
      }
      // Cancel or shutdown while checks ran: report what ran, don't present it as verified.
      if (signal.aborted) {
        report.outcome = "cancelled";
        report.error = [report.error, "cancelled while the harness checks were running"].filter(Boolean).join("; ");
      }
    }
    return report;
  }

  function launch(task: TaskRecord, job: WorkerJob, timeoutMs: number) {
    const controller = new AbortController();
    controllers.set(task.id, controller);
    const run = (async () => {
      const result = await runWorker(job, {
        signal: controller.signal, timeoutMs,
        onProgress: (p) => {
          task.toolCalls = p.toolCalls;
          task.activity = p.activity;
          task.cost = p.usage.cost;
          task.lastEventAt = p.lastEventAt;
        },
      });
      task.cost = result.progress.usage.cost;
      task.activity = "harness checks";
      let report: TaskReport;
      try {
        // The controller stays registered through the checks, so crew_cancel,
        // /crew-stop, and shutdown can still stop them.
        report = await buildReport(task, result, controller.signal);
      } catch (error) {
        report = {
          id: task.id, kind: task.kind, title: task.title, outcome: "failed", model: task.model,
          commits: [], diffStat: "", outOfScope: [], autoCommitted: false, checks: [], cost: task.cost,
          durationMs: Date.now() - task.startedAt, error: (error as Error).message,
        };
      }
      controllers.delete(task.id);
      task.report = report;
      task.endedAt = Date.now();
      task.status = shuttingDown ? "interrupted"
        : report.outcome === "submitted" ? "submitted"
        : report.outcome === "failed" ? "failed" : report.outcome;
      persist();
      render();
      tell("crew-handoff", formatReport(report), !quietCancels.delete(task.id));
    })();
    pending.add(run);
    run.finally(() => pending.delete(run));
  }

  // ---- tools -------------------------------------------------------------

  pi.registerTool({
    name: "crew_dispatch",
    label: "Crew dispatch",
    description: "Start a crew worker in the background and return immediately. kind \"implement\": a fresh agent in its own git worktree branched from the integration branch; it edits, runs bash, and commits. kind \"review\": a fresh read-only reviewer that sees only reviewOf's diff and spec. Its handoff arrives later as a message that wakes you. The spec must stand alone, because workers have not seen this conversation.",
    promptGuidelines: ["Only available while a crew is active. You are the planner: delegate implementation, testing, review, and conflict repair through crew_dispatch instead of doing them yourself."],
    parameters: Type.Object({
      kind: StringEnum(["implement", "review"]),
      title: Type.String({ minLength: 1, maxLength: 120 }),
      spec: Type.String({ description: "Self-contained task description: outcome, context, relevant files, constraints. For reviews: what to focus on (may be empty)." }),
      acceptance: Type.Optional(Type.Array(Type.String(), { description: "Acceptance criteria" })),
      checks: Type.Optional(Type.Array(Type.String(), { description: "Shell commands the harness runs in the worktree afterwards, e.g. \"npm test\". Exit 0 = pass." })),
      paths: Type.Optional(Type.Array(Type.String(), { description: "Repo-relative path prefixes the task may change; changes elsewhere are flagged" })),
      reviewOf: Type.Optional(Type.Integer({ minimum: 1, description: "Task id to review (kind review only)" })),
      timeoutMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 180 })),
    }),
    // Worktree creation and HEAD reads touch shared git state; dispatch returns fast anyway.
    executionMode: "sequential",
    async execute(_id, params) {
      const state = requireCrew();
      const c = state.config;
      if (spent(state) >= c.budgetUsd) throw new Error(`Budget exhausted ($${spent(state).toFixed(2)} of $${c.budgetUsd}). Escalate to the human.`);
      if (runningTasks(state).length >= c.maxConcurrent) {
        throw new Error(`${c.maxConcurrent} workers already running. End your turn; the next handoff will wake you.`);
      }
      const review = params.kind === "review";
      const target = review ? state.tasks.find((t) => t.id === params.reviewOf) : undefined;
      if (review && (!target || target.kind !== "implement" || !target.worktree || !target.base || target.status === "running")) {
        throw new Error("reviewOf must name a finished implement task");
      }
      if (!review && params.reviewOf) throw new Error("reviewOf is only for kind review");
      const model = review ? c.reviewerModel : c.workerModel;
      // Record the task before any await so parallel calls can't exceed the slot limit.
      const task: TaskRecord = {
        id: state.nextId++, kind: params.kind, title: params.title, spec: params.spec,
        acceptance: params.acceptance ?? [], checks: review ? [] : params.checks ?? [], paths: params.paths ?? [],
        reviewOf: params.reviewOf, model: ref(model), status: "running", startedAt: Date.now(),
        cost: 0, toolCalls: 0, activity: "starting", lastEventAt: Date.now(),
      };
      state.tasks.push(task);
      let prompt: string;
      try {
        if (review) {
          task.worktree = target!.worktree;
          task.base = target!.base;
          task.branch = target!.branch;
          const facts = await branchFacts(task.worktree!, task.base!);
          prompt = reviewerPrompt(c, task, target!, facts.diffStat, await diffText(task.worktree!, task.base!, REVIEW_DIFF_BYTES));
        } else {
          task.branch = `${c.integrationBranch}-t${task.id}`;
          task.worktree = worktreePath(c.repoName, task.branch);
          task.base = (await gitOk(c.integrationPath, ["rev-parse", "HEAD"])).trim();
          await addWorktree(c.repoRoot, task.worktree, task.branch, task.base);
          prompt = workerPrompt(c, task);
        }
      } catch (error) {
        task.status = "failed";
        task.endedAt = Date.now();
        persist();
        throw error;
      }
      persist();
      render();
      launch(task, {
        provider: model.provider, model: model.model, cwd: task.worktree!, prompt,
        tools: review ? READ_TOOLS : WRITE_TOOLS, extensions: [...CHILD_EXTENSIONS, GUARD],
        env: { ...GIT_ENV, PI_CREW_ROOT: task.worktree! },
      }, (params.timeoutMinutes ?? c.taskTimeoutMin) * 60_000);
      return text(`Dispatched #${task.id} (${task.kind}) "${task.title}" to ${task.model}${review ? ` reviewing #${task.reviewOf}` : ` on ${task.branch}`}. Its handoff will arrive as a message. Don't poll: dispatch other independent work or end your turn.`);
    },
  });

  pi.registerTool({
    name: "crew_integrate",
    label: "Crew integrate",
    description: "Merge a finished implement task's branch into the crew integration branch (harness-run git merge --no-ff). On conflict the merge is aborted and the conflicting files are returned, so you can dispatch a repair task.",
    parameters: Type.Object({ taskId: Type.Integer({ minimum: 1 }) }),
    // Two merges in one worktree at once collide on index.lock, which would be misread as a conflict.
    executionMode: "sequential",
    async execute(_id, params) {
      const state = requireCrew();
      const task = state.tasks.find((t) => t.id === params.taskId);
      if (!task || task.kind !== "implement" || !task.branch || !task.base) throw new Error(`#${params.taskId} is not an implement task`);
      if (task.status === "running") throw new Error(`#${task.id} is still running`);
      if (task.status === "integrated") throw new Error(`#${task.id} is already integrated`);
      if (!task.report?.commits.length) throw new Error(`#${task.id} has no commits to merge`);
      const result = await mergeBranch(state.config.integrationPath, task.branch, `crew: merge #${task.id} ${task.title}`);
      if (!result.ok) {
        task.status = "conflict";
        persist();
        return text(`Merge of #${task.id} (${task.branch}) into ${state.config.integrationBranch} CONFLICTED and was aborted.\nConflicting files:\n${result.conflicts.map((f) => `- ${f}`).join("\n") || "(none reported)"}\n${result.output.slice(-1500)}\n\nTo repair: dispatch an implement task whose worker runs \`git merge ${task.branch}\` in its fresh worktree (branched from the current integration branch), resolves the conflicts preserving both intents, runs the checks, and commits. Then integrate that task instead.`);
      }
      task.status = "integrated";
      persist();
      render();
      const head = (await gitOk(state.config.integrationPath, ["log", "--oneline", "-1"])).trim();
      // Informational, not a gate (Cursor: per-merge perfection serializes everything).
      // It catches clean merges that still break each other.
      const checks = [];
      for (const command of task.checks) checks.push(await runCheck(state.config.integrationPath, command, CHECK_TIMEOUT_MS));
      const failed = checks.filter((c) => c.exit !== 0);
      const summary = !checks.length ? "No task checks to re-run."
        : failed.length ? `Post-merge checks FAILED on the integration branch (merge kept):\n${failed.map((c) => `- ${c.timedOut ? "timed out" : `exit ${c.exit}`}: ${c.command}\n${c.tail.trimEnd().split("\n").slice(-15).map((l) => `    ${l}`).join("\n")}`).join("\n")}\nDispatch a fix task.`
        : `Post-merge checks passed on the integration branch: ${task.checks.join("; ")}`;
      return text(`Integrated #${task.id} into ${state.config.integrationBranch} (now at ${head}). New workers branch from here.\n${summary}`);
    },
  });

  pi.registerTool({
    name: "crew_status",
    label: "Crew status",
    description: "Show the crew ledger: tasks, status, spend, and liveness of running workers.",
    parameters: Type.Object({}),
    async execute() {
      return text(formatStatus(requireCrew()));
    },
  });

  pi.registerTool({
    name: "crew_cancel",
    label: "Crew cancel",
    description: "Stop a running worker. Its worktree, commits, and partial output are kept and reported in a handoff.",
    parameters: Type.Object({ taskId: Type.Integer({ minimum: 1 }) }),
    async execute(_id, params) {
      requireCrew();
      const controller = controllers.get(params.taskId);
      if (!controller) throw new Error(`#${params.taskId} is not running`);
      quietCancels.add(params.taskId);
      controller.abort();
      return text(`Cancelling #${params.taskId}; its handoff will arrive without waking you.`);
    },
  });

  pi.registerTool({
    name: "crew_wake",
    label: "Crew wake",
    description: "Schedule a check-in message to yourself (Devin-style) with the current ledger, e.g. to revisit a slow task. Handoffs wake you anyway; use this for time-based follow-ups.",
    parameters: Type.Object({
      minutes: Type.Integer({ minimum: 1, maximum: 240 }),
      note: Type.String({ minLength: 1, description: "What to look at when you wake" }),
    }),
    async execute(_id, params) {
      requireCrew();
      const timer = setTimeout(() => {
        wakeTimers.delete(timer);
        if (crew && isActive()) tell("crew-wake", `Scheduled check-in: ${params.note}\n\n${formatStatus(crew)}`, true);
      }, params.minutes * 60_000);
      wakeTimers.add(timer);
      return text(`Will wake you in ${params.minutes} min.`);
    },
  });

  pi.registerTool({
    name: "crew_finish",
    label: "Crew finish",
    description: "Declare the crew goal done. Requires no running workers. The harness first runs `checks` on the integration branch (the final green pass) and refuses to finish if any fail. Hands the integration branch to the human and ends crew mode.",
    parameters: Type.Object({
      summary: Type.String({ minLength: 1 }),
      checks: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Full verification commands (tests, lint, typecheck) to run on the integration branch" }),
    }),
    async execute(_id, params) {
      const state = requireCrew();
      if (runningTasks(state).length) throw new Error("Workers are still running; wait for their handoffs or crew_cancel them");
      const results = [];
      for (const command of params.checks) results.push(await runCheck(state.config.integrationPath, command, CHECK_TIMEOUT_MS));
      const failed = results.filter((c) => c.exit !== 0);
      if (failed.length) {
        return text(`NOT finished: the final green pass failed on ${state.config.integrationBranch}:\n${failed.map((c) => `- ${c.timedOut ? "timed out" : `exit ${c.exit}`}: ${c.command}\n${c.tail.trimEnd().split("\n").slice(-20).map((l) => `    ${l}`).join("\n")}`).join("\n")}\nDispatch a green-pass task to fix this, integrate it, then call crew_finish again.`);
      }
      state.status = "finished";
      state.summary = params.summary;
      persist();
      deactivate();
      const c = state.config;
      return text(`Crew finished. Final checks passed on ${c.integrationBranch}: ${params.checks.join("; ")}. The human reviews ${c.integrationBranch} (worktree ${c.integrationPath}) and merges it. Tell them they can run \`/review-loop crew ${c.slug}\` for a multi-reviewer review-and-fix pass first. Summarize for them:\n${params.summary}`);
    },
  });

  // ---- commands ----------------------------------------------------------

  async function pickModel(ctx: ExtensionContext, title: string, first?: string): Promise<ModelRef | undefined> {
    const options = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);
    const choice = await ctx.ui.select(title, first ? [first, ...options] : options);
    if (!choice || choice === first) return undefined;
    const cut = choice.indexOf("/");
    return { provider: choice.slice(0, cut), model: choice.slice(cut + 1) };
  }

  pi.registerCommand("crew", {
    description: "Start a crew: a planner (this session) delegating to worktree workers. /crew <goal>",
    async handler(args, ctx) {
      try {
        if (!ctx.hasUI) throw new Error("/crew needs an interactive UI to confirm models and budget");
        if (isActive()) throw new Error(`Crew ${crew!.config.slug} is already active. /crew-stop it first.`);
        const goal = args.trim() || (await ctx.ui.editor("Crew goal"))?.trim();
        if (!goal) return;
        const info = await repoInfo(ctx.cwd);
        if (info.dirty && !(await ctx.ui.confirm("Uncommitted changes", "Workers branch from HEAD; your uncommitted changes won't be included. Continue?"))) return;
        const workerModel = await pickModel(ctx, "Worker model (implements tasks)");
        if (!workerModel) return;
        const reviewerModel = (await pickModel(ctx, "Reviewer model (clean-context reviews)", `same as worker (${ref(workerModel)})`)) ?? workerModel;
        const concurrency = await ctx.ui.select("Max concurrent workers", ["3", "2", "1", "4", "5"]);
        if (!concurrency) return;
        const budgetRaw = await ctx.ui.input("Worker budget in USD", String(DEFAULTS.budgetUsd));
        if (budgetRaw === undefined) return;
        const budgetUsd = budgetRaw.trim() ? Number(budgetRaw) : DEFAULTS.budgetUsd;
        if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error(`Invalid budget: ${budgetRaw}`);
        const slug = slugify(goal);
        const integrationBranch = `crew/${slug}`;
        const integrationPath = worktreePath(info.name, integrationBranch);
        await addWorktree(info.root, integrationPath, integrationBranch, info.head);
        crew = {
          version: 1, status: "active", tasks: [], nextId: 1,
          config: {
            slug, goal, repoRoot: info.root, repoName: info.name, commonDir: info.commonDir,
            integrationBranch, integrationPath, baseSha: info.head, workerModel, reviewerModel,
            maxConcurrent: Number(concurrency), budgetUsd, taskTimeoutMin: DEFAULTS.taskTimeoutMin,
            stallMin: DEFAULTS.stallMin, createdAt: Date.now(),
          },
        };
        persist();
        activate();
        tell("crew-start", `Crew started. Integration branch: ${integrationBranch} (worktree ${integrationPath}). Workers: ${ref(workerModel)}; reviewer: ${ref(reviewerModel)}; up to ${concurrency} at once; budget $${budgetUsd}.\n\nGoal:\n${goal}\n\nExplore just enough to plan, then dispatch the first independent tasks.`, true);
      } catch (error) {
        ctx.ui.notify((error as Error).message, "error");
      }
    },
  });

  pi.registerCommand("crew-status", {
    description: "Show the crew ledger",
    async handler(_args, ctx) {
      let state = crew;
      try {
        state ??= listCrews(await commonDirOf(ctx.cwd))[0];
      } catch {
        state = undefined; // not a git repository
      }
      const message = state ? formatStatus(state) : "No crews in this repository";
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("crew-stop", {
    description: "Stop the crew: cancel running workers (worktrees kept) and leave planner mode",
    async handler(_args, ctx) {
      if (!crew || !isActive()) return ctx.ui.notify("No active crew", "info");
      for (const [id, controller] of controllers) { quietCancels.add(id); controller.abort(); }
      crew.status = "stopped";
      persist();
      deactivate();
      ctx.ui.notify(`Crew ${crew.config.slug} stopped. Resume with /crew-resume.`, "info");
    },
  });

  pi.registerCommand("crew-resume", {
    description: "Resume the latest (or named) stopped crew in this repo: /crew-resume [slug]",
    async handler(args, ctx) {
      try {
        if (isActive()) throw new Error(`Crew ${crew!.config.slug} is already active`);
        const crews = listCrews(await commonDirOf(ctx.cwd)).filter((s) => s.status !== "finished");
        const state = args.trim() ? crews.find((s) => s.config.slug === args.trim()) : crews[0];
        if (!state) throw new Error("No resumable crew in this repository");
        // Processes from a previous session are gone; keep their worktrees as evidence.
        for (const t of runningTasks(state)) { t.status = "interrupted"; t.endedAt = Date.now(); }
        state.status = "active";
        crew = state;
        persist();
        activate();
        tell("crew-resume", `Crew resumed. Goal:\n${state.config.goal}\n\n${formatStatus(state)}\n\nInterrupted tasks kept their worktrees and branches; integrate them only if their commits are complete, otherwise re-dispatch.`, true);
      } catch (error) {
        ctx.ui.notify((error as Error).message, "error");
      }
    },
  });

  pi.registerCommand("crew-clean", {
    description: "Remove worktrees and branches of finished crew tasks (not the integration branch)",
    async handler(_args, ctx) {
      const state = crew ?? listCrews(await commonDirOf(ctx.cwd))[0];
      if (!state) return ctx.ui.notify("No crews in this repository", "info");
      const reviewing = new Set(state.tasks.filter((t) => t.kind === "review" && t.status === "running").map((t) => t.reviewOf));
      const done = state.tasks.filter((t) => t.kind === "implement" && t.worktree && t.status !== "running" && !reviewing.has(t.id));
      if (!done.length) return ctx.ui.notify("Nothing to clean", "info");
      const ok = await ctx.ui.confirm("Remove task worktrees?", `${done.length} worktrees and branches of crew ${state.config.slug} (${done.map((t) => `#${t.id} ${t.status}`).join(", ")}). Unintegrated work on those branches is deleted.`);
      if (!ok) return;
      for (const t of done) {
        await removeWorktree(state.config.repoRoot, t.worktree!, t.branch);
        t.worktree = undefined;
      }
      if (state === crew) persist();
      else saveState(state);
      ctx.ui.notify(`Removed ${done.length} task worktrees`, "info");
    },
  });

  // ---- lifecycle ---------------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    ui = ctx;
    // Registered tools start active; crew tools exist only in planner mode.
    if (!isActive()) pi.setActiveTools(pi.getActiveTools().filter((t) => !CREW_TOOLS.includes(t)));
  });

  pi.on("before_agent_start", (event) => {
    if (crew && isActive()) event.systemPromptOptions.sections.crew_planner = plannerPrompt(crew.config);
    else delete event.systemPromptOptions.sections.crew_planner;
  });

  pi.on("session_shutdown", async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(sweepTimer);
    clearInterval(renderTimer);
    for (const timer of wakeTimers) clearTimeout(timer);
    for (const controller of controllers.values()) controller.abort();
    await Promise.all([...pending]);
    persist();
  });
}

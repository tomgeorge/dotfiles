import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { openPanel as showPanel } from "../run-panel/pi.ts";
import {
  addWorktree, branchCommits, branchFacts, commitAll, commonDirOf, diffText, dirtyFiles, discardChanges, GIT_ENV, gitOk,
  mergeBranch, outsidePaths, removeWorktree, repoInfo, runChecks, worktreePath,
} from "./git.ts";
import { failedChecks, formatReport, parseHandoff, type Outcome, type TaskReport } from "./handoff.ts";
import { plannerPrompt, reviewerPrompt, workerPrompt } from "./prompts.ts";
import {
  formatStatus, formatWidget, listCrews, loadState, money, ref, runningTasks, saveState, sessionPath, slugify, spent,
  type CrewConfig, type CrewState, type ModelRef, type TaskRecord, type TaskStatus,
} from "./state.ts";
import { crewSource } from "./source.ts";
import { Transcript } from "./transcript.ts";
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
// Free in Pi's defaults and in Ghostty on macOS; Linux terminals often bind it to copy.
const PANEL_KEY = "ctrl+shift+c";
// A crew that isn't live in this session is re-read from its ledger at most this often.
const LEDGER_RELOAD_MS = 2_000;

/** A finished implement task with the worktree and base a review needs. */
type ReviewableTask = TaskRecord & { worktree: string; base: string };
/** What crew_dispatch sets up before the worker starts. */
interface Prepared { prompt: string; worktree: string }

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
const addError = (report: TaskReport, error: string) => {
  report.error = [report.error, error].filter(Boolean).join("; ");
};
/** A report with nothing observed yet; the harness fills in what it can. */
const emptyReport = (task: TaskRecord, outcome: Outcome, cost: number): TaskReport => ({
  id: task.id, kind: task.kind, title: task.title, outcome, model: task.model,
  commits: [], diffStat: "", outOfScope: [], autoCommitted: false, checks: [],
  cost, durationMs: Date.now() - task.startedAt,
});
const endTask = (task: TaskRecord, status: TaskStatus) => {
  task.status = status;
  task.endedAt = Date.now();
};
/** Planner-tool checks stop with the crew or with the tool call. */
const checkSignal = (crewSignal: AbortSignal, toolSignal: AbortSignal | undefined) =>
  toolSignal ? AbortSignal.any([crewSignal, toolSignal]) : crewSignal;

const EXPORT_TIMEOUT_MS = 60_000;

/** `pi --export`, as /export does; pi doesn't export its HTML exporter to extensions. */
function piExport(session: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("pi", ["--export", session, output], { timeout: EXPORT_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
}

// Tests inject fakes; Pi calls the factory with the API only.
export default function (pi: ExtensionAPI, deps: { runWorker?: typeof runWorker; exportSession?: typeof piExport } = {}) {
  const startWorker = deps.runWorker ?? runWorker;
  const exportSession = deps.exportSession ?? piExport;
  // Streamed conversations of workers started in this session, for the Live tab.
  const transcripts = new WeakMap<TaskRecord, Transcript>();
  const exporting = new Set<string>();
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
  // In-flight crew_integrate and crew_finish: their worktree cleanup runs even after an abort.
  const planning = new Set<Promise<unknown>>();
  // /crew and /crew-resume replace `crew`; only one may do so at a time.
  let switching = false;
  // Planner-tool checks (post-merge, crew_finish) stop with the crew; workers have their own controllers.
  let crewAbort = new AbortController();
  let panelOpen = false;
  let closePanel: (() => void) | undefined;

  const isActive = () => crew?.status === "active";
  const withoutCrewTools = () => pi.getActiveTools().filter((t) => !CREW_TOOLS.includes(t));

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
    ui.ui.setWidget("crew", formatWidget(crew, `${PANEL_KEY} or /crew`), { placement: "belowEditor" });
    ui.ui.setStatus("crew", `crew: ${runningTasks(crew).length} running`);
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
      tell("crew-budget", `Budget reached: ${money(spent(crew))} of ${money(crew.config.budgetUsd)}. New dispatches are refused; running workers continue. Finish with what's integrated or escalate for more budget.`, true);
    }
    persist();
  }

  function activate() {
    toolsBefore ??= withoutCrewTools();
    crewAbort = new AbortController();
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
    crewAbort.abort();
    pi.setActiveTools(toolsBefore ?? withoutCrewTools());
    toolsBefore = undefined;
    stopTimers();
    render();
  }

  function stopTimers() {
    clearInterval(sweepTimer);
    clearInterval(renderTimer);
    sweepTimer = renderTimer = undefined;
    for (const timer of wakeTimers) clearTimeout(timer);
    wakeTimers.clear();
  }

  function track<T>(work: Promise<T>): Promise<T> {
    planning.add(work);
    // The caller handles the rejection; this branch only must not surface it as unhandled.
    work.finally(() => planning.delete(work)).catch(() => {});
    return work;
  }

  /** Let a stopped crew's workers and tools finish, so they save into its state, not the next one's. */
  async function drain(ctx: ExtensionContext) {
    if (pending.size || planning.size) ctx.ui.notify("crew: waiting for the stopped crew's workers to finish…", "info");
    while (pending.size || planning.size) await Promise.allSettled([...pending, ...planning]);
  }

  /** Run a crew start or resume, refusing a second one while it's in progress. */
  async function switchCrew(ctx: ExtensionContext, body: () => Promise<void>) {
    try {
      if (switching) throw new Error("A crew start or resume is already in progress");
      switching = true;
      try {
        await body();
      } finally {
        switching = false;
      }
    } catch (error) {
      ctx.ui.notify((error as Error).message, "error");
    }
  }

  function requireCrew(): CrewState {
    if (!crew || !isActive()) throw new Error("No active crew. The human starts one with /crew <goal>.");
    return crew;
  }

  /** What the branch says, independent of the worker's claims. */
  async function observeBranch(task: TaskRecord, worktree: string, base: string, report: TaskReport) {
    try {
      report.autoCommitted = await commitAll(worktree, `crew: uncommitted changes left by task #${task.id}`);
      const facts = await branchFacts(worktree, base);
      report.commits = facts.commits;
      report.diffStat = facts.diffStat;
      report.outOfScope = outsidePaths(facts.files, task.paths);
    } catch (error) {
      addError(report, `harness: ${(error as Error).message}`);
    }
  }

  async function runTaskChecks(task: TaskRecord, worktree: string, report: TaskReport, signal: AbortSignal) {
    report.checks = await runChecks(worktree, task.checks, CHECK_TIMEOUT_MS, signal);
    // npm install, lint --fix: a pass may depend on files that never reach the branch.
    if (report.checks.length) {
      try {
        report.dirtyAfterChecks = await dirtyFiles(worktree);
      } catch (error) {
        addError(report, `harness: ${(error as Error).message}`);
      }
    }
    // Cancel or shutdown while checks ran: report what ran, don't present it as verified.
    if (signal.aborted) {
      report.outcome = "cancelled";
      addError(report, "cancelled while the harness checks were running");
    }
  }

  async function buildReport(task: TaskRecord, result: WorkerResult, signal: AbortSignal): Promise<TaskReport> {
    const outcome = result.status === "ok" ? "submitted" : result.status === "error" ? "failed" : result.status;
    const parsed = parseHandoff(result.text);
    const report: TaskReport = {
      ...emptyReport(task, outcome, result.progress.usage.cost),
      handoff: parsed.handoff, parseError: parsed.error, branch: task.branch, base: task.base,
      error: result.error ?? undefined,
      partial: parsed.handoff ? undefined : result.text.slice(-3000) || undefined,
    };
    if (task.kind !== "implement" || !task.worktree || !task.base) return report;
    await observeBranch(task, task.worktree, task.base, report);
    // Checks are the harness's own evidence, so run them even when the worker timed out.
    if (outcome !== "cancelled" && !shuttingDown) await runTaskChecks(task, task.worktree, report, signal);
    return report;
  }

  function launch(task: TaskRecord, job: WorkerJob, timeoutMs: number) {
    const controller = new AbortController();
    controllers.set(task.id, controller);
    const transcript = new Transcript();
    transcripts.set(task, transcript);
    const run = (async () => {
      const result = await startWorker(job, {
        signal: controller.signal, timeoutMs,
        onEvent: (event) => transcript.applyEvent(event),
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
        report = { ...emptyReport(task, "failed", task.cost), error: (error as Error).message };
      }
      // A later crew may reuse this id after a stop.
      if (controllers.get(task.id) === controller) controllers.delete(task.id);
      task.report = report;
      endTask(task, shuttingDown ? "interrupted" : report.outcome);
      persist();
      render();
      tell("crew-handoff", formatReport(report), !quietCancels.delete(task.id));
    })();
    pending.add(run);
    run.finally(() => pending.delete(run));
  }

  // ---- tools -------------------------------------------------------------

  /** The finished implement task a review reads; undefined for an implement dispatch. */
  function reviewTarget(state: CrewState, params: { kind: string; reviewOf?: number }): ReviewableTask | undefined {
    if (params.kind !== "review") {
      if (params.reviewOf) throw new Error("reviewOf is only for kind review");
      return undefined;
    }
    const target = state.tasks.find((t) => t.id === params.reviewOf);
    if (!target || target.kind !== "implement" || !target.worktree || !target.base || target.status === "running") {
      throw new Error("reviewOf must name a finished implement task");
    }
    return target as ReviewableTask;
  }

  /** A reviewer works in the reviewed task's worktree; its prompt carries the diff. */
  async function prepareReview(c: CrewConfig, task: TaskRecord, target: ReviewableTask): Promise<Prepared> {
    const { worktree, base } = target;
    task.worktree = worktree;
    task.base = base;
    task.branch = target.branch;
    const facts = await branchFacts(worktree, base);
    const prompt = reviewerPrompt(c, task, target, facts.diffStat, await diffText(worktree, base, REVIEW_DIFF_BYTES));
    return { prompt, worktree };
  }

  /** A fresh branch and worktree from the integration branch's current tip. */
  async function prepareWorktree(c: CrewConfig, task: TaskRecord): Promise<Prepared> {
    task.branch = `${c.integrationBranch}-t${task.id}`;
    const worktree = worktreePath(c.repoName, task.branch);
    task.worktree = worktree;
    task.base = (await gitOk(c.integrationPath, ["rev-parse", "HEAD"])).trim();
    await addWorktree(c.repoRoot, worktree, task.branch, task.base);
    return { prompt: workerPrompt(c, task), worktree };
  }

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
    execute: (_id, params) => track((async () => {
      const state = requireCrew();
      const c = state.config;
      if (spent(state) >= c.budgetUsd) throw new Error(`Budget exhausted (${money(spent(state))} of $${c.budgetUsd}). Escalate to the human.`);
      if (runningTasks(state).length >= c.maxConcurrent) {
        throw new Error(`${c.maxConcurrent} workers already running. End your turn; the next handoff will wake you.`);
      }
      const target = reviewTarget(state, params);
      const review = params.kind === "review";
      const model = review ? c.reviewerModel : c.workerModel;
      // Record the task before any await so parallel calls can't exceed the slot limit.
      const task: TaskRecord = {
        id: state.nextId++, kind: review ? "review" : "implement", title: params.title, spec: params.spec,
        acceptance: params.acceptance ?? [], checks: review ? [] : params.checks ?? [], paths: params.paths ?? [],
        reviewOf: params.reviewOf, model: ref(model), status: "running", startedAt: Date.now(),
        cost: 0, toolCalls: 0, activity: "starting", lastEventAt: Date.now(),
      };
      state.tasks.push(task);
      let prepared: Prepared;
      try {
        // Outside every worktree, beside the ledger, so the transcript survives /crew-clean.
        task.session = sessionPath(c.commonDir, c.slug, task.id);
        mkdirSync(dirname(task.session), { recursive: true, mode: 0o700 });
        prepared = target ? await prepareReview(c, task, target) : await prepareWorktree(c, task);
      } catch (error) {
        endTask(task, "failed");
        persist();
        throw error;
      }
      // /crew-stop (and maybe a resume) while the worktree was set up: no controller existed to abort.
      if (crew !== state || !isActive()) {
        endTask(task, "cancelled");
        saveState(state);
        throw new Error(`Crew was stopped while #${task.id} was being set up; it was not started (worktree ${task.worktree} kept).`);
      }
      persist();
      render();
      const { prompt, worktree } = prepared;
      launch(task, {
        provider: model.provider, model: model.model, cwd: worktree, prompt,
        tools: review ? READ_TOOLS : WRITE_TOOLS, extensions: [...CHILD_EXTENSIONS, GUARD],
        env: { ...GIT_ENV, PI_CREW_ROOT: worktree }, session: task.session,
      }, (params.timeoutMinutes ?? c.taskTimeoutMin) * 60_000);
      return text(`Dispatched #${task.id} (${task.kind}) "${task.title}" to ${task.model}${review ? ` reviewing #${task.reviewOf}` : ` on ${task.branch}`}. Its handoff will arrive as a message. Don't poll: dispatch other independent work or end your turn.`);
    })()),
  });

  /**
   * Re-run the task's checks after its merge. Informational, not a gate (Cursor: per-merge
   * perfection serializes everything); it catches clean merges that still break each other.
   */
  async function postMergeChecks(c: CrewConfig, task: TaskRecord, signal: AbortSignal): Promise<string> {
    const checks = await runChecks(c.integrationPath, task.checks, CHECK_TIMEOUT_MS, signal);
    // Leftovers would make the next merge fail as a false conflict.
    const dirty = await discardChanges(c.integrationPath);
    const failed = failedChecks(checks, 15);
    const summary = signal.aborted ? "Post-merge checks were cancelled (merge kept)."
      : !checks.length ? "No task checks to re-run."
      : failed.length ? `Post-merge checks FAILED on the integration branch (merge kept):\n${failed.join("\n")}\nDispatch a fix task.`
      : `Post-merge checks passed on the integration branch: ${task.checks.join("; ")}`;
    const note = dirty.length ? `\nThe checks modified files in the integration worktree; the harness reverted them: ${dirty.join(", ")}. If a check needs them (lockfile, generated code), dispatch a task to commit them.` : "";
    return summary + note;
  }

  pi.registerTool({
    name: "crew_integrate",
    label: "Crew integrate",
    description: "Merge a finished implement task's branch into the crew integration branch (harness-run git merge --no-ff). On conflict the merge is aborted and the conflicting files are returned, so you can dispatch a repair task.",
    parameters: Type.Object({ taskId: Type.Integer({ minimum: 1 }) }),
    // Two merges in one worktree at once collide on index.lock, which would be misread as a conflict.
    executionMode: "sequential",
    execute: (_id, params, toolSignal) => track((async () => {
      const state = requireCrew();
      const crewSignal = crewAbort.signal;
      const task = state.tasks.find((t) => t.id === params.taskId);
      if (!task || task.kind !== "implement" || !task.branch || !task.base) throw new Error(`#${params.taskId} is not an implement task`);
      if (task.status === "running") throw new Error(`#${task.id} is still running`);
      if (task.status === "integrated") throw new Error(`#${task.id} is already integrated`);
      // Read the branch, not the report: a task interrupted by a crash has no report but may have commits.
      if (!(await branchCommits(state.config.repoRoot, task.base, task.branch)).length) throw new Error(`#${task.id} has no commits to merge`);
      const result = await mergeBranch(state.config.integrationPath, task.branch, `crew: merge #${task.id} ${task.title}`);
      if (!result.ok) {
        task.status = "conflict";
        persist();
        const conflicts = result.conflicts.map((f) => `- ${f}`).join("\n") || "(none reported)";
        return text(`Merge of #${task.id} (${task.branch}) into ${state.config.integrationBranch} CONFLICTED and was aborted.\nConflicting files:\n${conflicts}\n${result.output.slice(-1500)}\n\nTo repair: dispatch an implement task whose worker runs \`git merge ${task.branch}\` in its fresh worktree (branched from the current integration branch), resolves the conflicts preserving both intents, runs the checks, and commits. Then integrate that task instead.`);
      }
      task.status = "integrated";
      persist();
      render();
      const head = (await gitOk(state.config.integrationPath, ["log", "--oneline", "-1"])).trim();
      const verdict = await postMergeChecks(state.config, task, checkSignal(crewSignal, toolSignal));
      return text(`Integrated #${task.id} into ${state.config.integrationBranch} (now at ${head}). New workers branch from here.\n${verdict}`);
    })()),
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
    execute: (_id, params, toolSignal) => track((async () => {
      const state = requireCrew();
      if (runningTasks(state).length) throw new Error("Workers are still running; wait for their handoffs or crew_cancel them");
      const crewSignal = crewAbort.signal;
      const signal = checkSignal(crewSignal, toolSignal);
      const results = await runChecks(state.config.integrationPath, params.checks, CHECK_TIMEOUT_MS, signal);
      const dirty = await discardChanges(state.config.integrationPath);
      // /crew-stop (or a stop then resume) while the checks ran: this call no longer owns the crew.
      if (crewSignal.aborted || crew !== state || !isActive()) return text("NOT finished: the crew was stopped while the final checks ran.");
      if (signal.aborted) return text("NOT finished: the final checks were cancelled.");
      const problems = failedChecks(results, 20);
      if (dirty.length) problems.push(`- the checks modified files in the integration worktree, so they passed only with uncommitted changes (the harness reverted them): ${dirty.join(", ")}`);
      if (problems.length) {
        return text(`NOT finished: the final green pass failed on ${state.config.integrationBranch}:\n${problems.join("\n")}\nDispatch a green-pass task to fix this (commit any files the checks need), integrate it, then call crew_finish again.`);
      }
      state.status = "finished";
      state.summary = params.summary;
      persist();
      deactivate();
      const c = state.config;
      return text(`Crew finished. Final checks passed on ${c.integrationBranch}: ${params.checks.join("; ")}. The human reviews ${c.integrationBranch} (worktree ${c.integrationPath}) and merges it. Tell them they can run \`/review-loop crew ${c.slug}\` for a multi-reviewer review-and-fix pass first. Summarize for them:\n${params.summary}`);
    })()),
  });

  // ---- panel -------------------------------------------------------------

  /** The in-session crew, else the newest crew in the ledger of this repo. `unfinished` skips finished ones. */
  async function panelCrew(ctx: ExtensionContext, unfinished = false): Promise<CrewState | undefined> {
    const open = (s: CrewState) => !unfinished || s.status !== "finished";
    if (crew && open(crew)) return crew;
    try {
      return listCrews(await commonDirOf(ctx.cwd)).find(open);
    } catch {
      return undefined; // not a git repository
    }
  }

  async function copyPath(path: string): Promise<string> {
    try {
      // Imported here so the tests, which have no Pi runtime, never load it.
      const { copyToClipboard } = await import("@earendil-works/pi-coding-agent");
      await copyToClipboard(path);
      return `Copied ${path}`;
    } catch {
      return path; // no clipboard here: the path is shown for copying by hand
    }
  }

  /** Show the panel. Resolves once it's up, not when it closes: Pi blocks the editor while a command handler runs. */
  async function openPanel(ctx: ExtensionContext, found?: CrewState) {
    if (!ctx.hasUI || panelOpen) return;
    // Claimed before the await so a double press opens one panel.
    panelOpen = true;
    const initial = found ?? await panelCrew(ctx);
    if (!initial) {
      panelOpen = false;
      return ctx.ui.notify("No crews in this repository. Start one with /crew <goal>.", "info");
    }
    const { slug, commonDir } = initial.config;
    let ledger = initial;
    let loadedAt = Date.now();
    // Memory is fresher than the ledger for running tasks (cost, activity, last event).
    const current = (): CrewState => {
      if (crew?.config.slug === slug) return crew;
      if (Date.now() - loadedAt >= LEDGER_RELOAD_MS) {
        loadedAt = Date.now();
        try { ledger = loadState(commonDir, slug); } catch { /* keep the last good copy */ }
      }
      return ledger;
    };
    const live = () => current() === crew && isActive();
    const source = crewSource(current, {
      live,
      cancel(id) {
        // Task ids repeat across crews: only the live crew's workers are ours to stop.
        const controller = live() ? controllers.get(id) : undefined;
        controller?.abort();
        return !!controller;
      },
      streamed: (task) => transcripts.get(task),
      copyPath,
      exportSession,
      exporting,
      fileExists: existsSync,
    });
    // The panel never awaits planner work, so handoffs keep waking the planner while it's open.
    const handle = showPanel(ctx, source, { id: "crew", closeKey: PANEL_KEY });
    if (!handle) {
      panelOpen = false;
      return;
    }
    closePanel = handle.close;
    void handle.closed.finally(() => { panelOpen = false; closePanel = undefined; });
  }

  pi.registerShortcut(PANEL_KEY, {
    description: "Open the crew panel",
    handler: (ctx) => openPanel(ctx),
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
    description: `Start a crew: a planner (this session) delegating to worktree workers. /crew <goal>. With no goal, open the current or last unfinished crew's panel (${PANEL_KEY})`,
    handler: (args, ctx) => switchCrew(ctx, async () => {
      if (!args.trim() && ctx.hasUI) {
        const found = await panelCrew(ctx, true);
        if (found) return openPanel(ctx, found);
      }
      if (!ctx.hasUI) throw new Error("/crew needs an interactive UI to confirm models and budget");
      if (isActive()) throw new Error(`Crew ${crew!.config.slug} is already active. /crew-stop it first.`);
      await drain(ctx);
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
      // The planner prompt rides in the message: Pi doesn't emit before_agent_start for
      // runs that sendMessage({ triggerTurn }) starts, and every planner run starts that way.
      tell("crew-start", `${plannerPrompt(crew.config)}\n\nCrew started. Integration branch: ${integrationBranch} (worktree ${integrationPath}). Workers: ${ref(workerModel)}; reviewer: ${ref(reviewerModel)}; up to ${concurrency} at once; budget $${budgetUsd}.\n\nGoal:\n${goal}\n\nExplore just enough to plan, then dispatch the first independent tasks.`, true);
    }),
  });

  pi.registerCommand("crew-status", {
    description: `Open the crew panel (${PANEL_KEY}); prints the ledger without a UI`,
    async handler(_args, ctx) {
      const state = await panelCrew(ctx);
      // The text ledger stays for print mode and the planner's crew_status tool.
      if (ctx.hasUI && state) return openPanel(ctx, state);
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
    handler: (args, ctx) => switchCrew(ctx, async () => {
      if (isActive()) throw new Error(`Crew ${crew!.config.slug} is already active`);
      await drain(ctx);
      const crews = listCrews(await commonDirOf(ctx.cwd)).filter((s) => s.status !== "finished");
      const state = args.trim() ? crews.find((s) => s.config.slug === args.trim()) : crews[0];
      if (!state) throw new Error("No resumable crew in this repository");
      // Processes from a previous session are gone; keep their worktrees as evidence.
      for (const t of runningTasks(state)) endTask(t, "interrupted");
      state.status = "active";
      crew = state;
      persist();
      activate();
      tell("crew-resume", `${plannerPrompt(state.config)}\n\nCrew resumed. ${formatStatus(state)}\n\nInterrupted tasks kept their worktrees and branches; integrate them only if their commits are complete, otherwise re-dispatch.`, true);
    }),
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
    if (!isActive()) pi.setActiveTools(withoutCrewTools());
  });

  pi.on("session_shutdown", async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    closePanel?.();
    stopTimers();
    for (const controller of controllers.values()) controller.abort();
    crewAbort.abort();
    await Promise.all([...pending]);
    persist();
  });
}

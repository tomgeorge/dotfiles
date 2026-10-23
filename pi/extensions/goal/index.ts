import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  continuationMessage, decide, GOAL_GUIDELINES, goalFromEntry, newGoal, parseGoalArgs, runCheck, startMessage, statusLine,
  type Goal, type LifecycleWord, type SetCommand,
} from "./goal.ts";

const CHECK_TIMEOUT_MS = 10 * 60_000;
const ENTRY = "goal-state";

export default function (pi: ExtensionAPI) {
  let goal: Goal | undefined;
  // The loaded session's context, kept for rendering status outside event handlers.
  let session: ExtensionContext | undefined;
  let toolCalls = 0;
  let aborted = false;
  let errored = false;
  let checking = false;

  function save() {
    // A snapshot: Pi keeps entry data by reference, and goal keeps changing.
    if (goal) pi.appendEntry(ENTRY, structuredClone(goal));
    render();
  }

  // goal_park only makes sense while a goal is active; don't declare it otherwise.
  function syncTools() {
    const tools = pi.getActiveTools().filter((t) => t !== "goal_park");
    pi.setActiveTools(goal?.status === "active" ? [...tools, "goal_park"] : tools);
  }

  function render() {
    syncTools();
    if (!session?.hasUI) return;
    session.ui.setStatus("goal", goal && goal.status !== "cleared"
      ? `goal ${goal.status === "active" ? `${goal.continuations}/${goal.maxContinuations}` : goal.status}`
      : undefined);
  }

  function say(content: string, wake = false) {
    pi.sendMessage({ customType: "goal", content, display: true }, { deliverAs: "followUp", triggerTurn: wake });
  }

  pi.registerTool({
    name: "goal_park",
    label: "Park goal",
    description: "Stop pursuing the active goal because you're blocked on something only the user can provide. Progress is kept; the user resumes with /goal resume.",
    promptGuidelines: GOAL_GUIDELINES,
    parameters: Type.Object({
      reason: Type.String({ minLength: 1, description: "What blocks progress" }),
      needed: Type.String({ minLength: 1, description: "Exactly what the user must provide or decide" }),
    }),
    async execute(_id, params) {
      if (!goal || goal.status !== "active") throw new Error("No active goal");
      goal.status = "parked";
      goal.reason = `${params.reason} Needs: ${params.needed}`;
      save();
      return { content: [{ type: "text" as const, text: "Goal parked. Tell the user what you need, then stop." }], details: undefined };
    },
  });

  /** Applies a lifecycle word and returns what to tell the user, or nothing when the goal speaks for itself. */
  function runLifecycle(word: LifecycleWord): string | undefined {
    switch (word) {
      case "status":
        return statusLine(goal);
      case "clear":
        if (goal) { goal.status = "cleared"; save(); }
        return "Goal cleared";
      case "pause":
        if (goal?.status !== "active") throw new Error("No active goal");
        goal.status = "paused";
        save();
        return "Goal paused. /goal resume to continue.";
      case "resume":
        if (!goal || goal.status === "cleared" || goal.status === "complete") throw new Error("No goal to resume");
        goal.status = "active";
        goal.reason = undefined;
        // Resuming after a budget stop grants a fresh budget of the same size.
        if (goal.continuations >= goal.maxContinuations) goal.continuations = 0;
        save();
        say(startMessage(goal, "resumed"), true);
        return undefined;
      default:
        return word satisfies never;
    }
  }

  // Whatever the command line left out is asked for interactively.
  async function setGoal(cmd: SetCommand, ctx: ExtensionContext) {
    let check = cmd.check;
    if (!check && ctx.hasUI) check = (await ctx.ui.input("Check command (exit 0 = goal met)", "npm test"))?.trim();
    if (!check) throw new Error("A goal needs --check <command>; it's how the harness knows you're done");
    const objective = cmd.objective || (ctx.hasUI ? (await ctx.ui.editor("Goal objective"))?.trim() ?? "" : "");
    goal = newGoal(objective, check, cmd.max);
    save();
    say(startMessage(goal, "set"), true);
  }

  pi.registerCommand("goal", {
    description: "Keep working until a check passes: /goal <objective> --check <cmd> [--max N] | status | pause | resume | clear",
    async handler(args, ctx) {
      const notify = (text: string, level: "info" | "error" = "info") => (ctx.hasUI ? ctx.ui.notify(text, level) : console.log(text));
      try {
        const cmd = parseGoalArgs(args);
        if (cmd.kind === "set") {
          await setGoal(cmd, ctx);
          return;
        }
        const text = runLifecycle(cmd.kind);
        if (text !== undefined) notify(text);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.on("agent_start", () => {
    toolCalls = 0;
    aborted = false;
    errored = false;
  });
  pi.on("tool_execution_start", () => { toolCalls++; });
  // Pi skips agent_before_settle when the user aborts, so read the outcome from each
  // assistant message instead. The last one wins for errors, so a retried error clears.
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    if (event.message.stopReason === "aborted" || ctx.signal?.aborted) aborted = true;
    errored = event.message.stopReason === "error";
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!goal || goal.status !== "active" || checking) return;
    checking = true;
    try {
      const active = goal;
      if (session?.hasUI) session.ui.setStatus("goal", "goal: checking…");
      const result = aborted ? undefined : await runCheck(ctx.cwd, active.check, CHECK_TIMEOUT_MS);
      if (goal !== active || active.status !== "active") return; // changed while the check ran
      if (result) active.lastCheck = result;
      const decision = decide(active, { checkPassed: result?.exit === 0, toolCalls, aborted, errored });
      switch (decision.action) {
        case "complete":
          active.status = "complete";
          save();
          return say(`Goal complete: \`${active.check}\` exits 0 after ${active.continuations} continuations.`);
        case "continue":
          active.continuations++;
          save();
          return say(continuationMessage(active), true);
        case "stop":
          active.status = decision.status;
          active.reason = decision.reason;
          save();
          return say(`Goal ${active.status}: ${decision.reason}. Last check: ${result ? `exit ${result.exit}` : "skipped"}. /goal resume to continue.`);
        case "none":
          return;
        default:
          return decision satisfies never;
      }
    } finally {
      checking = false;
      render();
    }
  });

  // The branch's latest goal entry wins, so forks, resumes, and /tree keep their own goal.
  function load(ctx: ExtensionContext) {
    session = ctx;
    goal = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      // A malformed latest entry can't be a goal we wrote; leave no goal rather than run on
      // garbage or resurrect an earlier goal that entry replaced.
      if (entry.type === "custom" && entry.customType === ENTRY) goal = goalFromEntry(entry.data);
    }
    render();
  }
  pi.on("session_start", (_event, ctx) => load(ctx));
  pi.on("session_tree", (_event, ctx) => load(ctx));
}

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  continuationMessage, decide, goalPrompt, newGoal, parseGoalArgs, runCheck, statusLine, type Goal,
} from "./goal.ts";

const CHECK_TIMEOUT_MS = 10 * 60_000;
const ENTRY = "goal-state";

export default function (pi: ExtensionAPI) {
  let goal: Goal | undefined;
  let ui: ExtensionContext | undefined;
  let toolCalls = 0;
  let aborted = false;
  let errored = false;
  let checking = false;

  function save() {
    if (goal) pi.appendEntry(ENTRY, goal);
    render();
  }

  // goal_park only makes sense while a goal is active; don't declare it otherwise.
  function syncTools() {
    const tools = pi.getActiveTools().filter((t) => t !== "goal_park");
    pi.setActiveTools(goal?.status === "active" ? [...tools, "goal_park"] : tools);
  }

  function render() {
    syncTools();
    if (!ui?.hasUI) return;
    ui.ui.setStatus("goal", goal && goal.status !== "cleared"
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

  pi.registerCommand("goal", {
    description: "Keep working until a check passes: /goal <objective> --check <cmd> [--max N] | status | pause | resume | clear",
    async handler(args, ctx) {
      const notify = (text: string, level: "info" | "error" = "info") => (ctx.hasUI ? ctx.ui.notify(text, level) : console.log(text));
      try {
        const cmd = parseGoalArgs(args);
        if (cmd.kind === "status") return notify(statusLine(goal));
        if (cmd.kind === "clear") {
          if (goal) { goal.status = "cleared"; save(); }
          return notify("Goal cleared");
        }
        if (cmd.kind === "pause") {
          if (goal?.status !== "active") throw new Error("No active goal");
          goal.status = "paused";
          save();
          return notify("Goal paused. /goal resume to continue.");
        }
        if (cmd.kind === "resume") {
          if (!goal || goal.status === "cleared" || goal.status === "complete") throw new Error("No goal to resume");
          goal.status = "active";
          goal.reason = undefined;
          // Resuming after a budget stop grants a fresh budget of the same size.
          if (goal.continuations >= goal.maxContinuations) goal.continuations = 0;
          save();
          return say(`Goal resumed: ${goal.objective}\nCheck: \`${goal.check}\``, true);
        }
        let check = cmd.check;
        if (!check && ctx.hasUI) check = (await ctx.ui.input("Check command (exit 0 = goal met)", "npm test"))?.trim();
        if (!check) throw new Error("A goal needs --check <command>; it's how the harness knows you're done");
        const objective = cmd.objective || (ctx.hasUI ? (await ctx.ui.editor("Goal objective"))?.trim() ?? "" : "");
        goal = newGoal(objective, check, cmd.max);
        save();
        say(`Goal set: ${goal.objective}\nDone when \`${goal.check}\` exits 0 (up to ${goal.maxContinuations} automatic continuations). Start working.`, true);
      } catch (error) {
        notify((error as Error).message, "error");
      }
    },
  });

  pi.on("agent_start", () => {
    toolCalls = 0;
    aborted = false;
    errored = false;
  });
  pi.on("tool_execution_start", () => { toolCalls++; });
  pi.on("agent_before_settle", (event) => {
    if (event.outcome === "aborted") aborted = true;
    if (event.outcome === "error") errored = true;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!goal || goal.status !== "active" || checking) return;
    checking = true;
    try {
      const active = goal;
      if (ui?.hasUI) ui.ui.setStatus("goal", "goal: checking…");
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
        case "pause":
        case "park":
        case "budget":
          active.status = decision.action === "pause" ? "paused" : decision.action === "park" ? "parked" : "budget";
          active.reason = decision.reason;
          save();
          return say(`Goal ${active.status}: ${decision.reason}. Last check: ${result ? `exit ${result.exit}` : "skipped"}. /goal resume to continue.`);
      }
    } finally {
      checking = false;
      render();
    }
  });

  pi.on("before_agent_start", (event) => {
    if (goal?.status === "active") event.systemPromptOptions.sections.goal = goalPrompt(goal);
    else delete event.systemPromptOptions.sections.goal;
  });

  pi.on("session_start", (_event, ctx) => {
    ui = ctx;
    goal = undefined;
    // The branch's latest goal entry wins, so forks and resumes keep their own goal.
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === ENTRY) goal = entry.data as Goal;
    }
    render();
  });
}

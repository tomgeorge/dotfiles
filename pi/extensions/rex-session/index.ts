// Gives pi the context Claude Code gets from Rex's SessionStart hook
// (`rex __internal session-start`): the session and pane IDs, and the
// instruction to name the agent's tab after the task.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Rex tells agents to rename the session, but one session holds many tabs,
// so the label belongs on the agent's own tab (a window in the CLI).
const SESSION_NAMING = /^Name the session [\s\S]*$/m;
const TAB_NAMING = `Name your tab as part of handling the first request that identifies the work.
Run \`rex window rename "$(rex whoami --json | jq -r .window_id)" <label>\` without
waiting for the user to ask and before loading the skill. Don't rename the session.
Use two to four lowercase words joined by hyphens, such as \`fix-login-redirect\`.
Name the task or project. Keep the existing label if it already describes the same work.`;

export default function (pi: ExtensionAPI) {
  let guidance: string | undefined;

  pi.on("session_start", async (_event, ctx) => {
    guidance = undefined;
    if (!process.env.REX_SESSION) return;
    const result = await pi.exec("rex", ["__internal", "session-start", "--agent", "pi"], {
      timeout: 5000,
    });
    const text = result.stdout.trim();
    if (result.code !== 0 || text === "") {
      ctx.ui.notify(`rex-session: rex session-start failed (exit ${result.code}): ${result.stderr.trim()}`, "warning");
      return;
    }
    if (!SESSION_NAMING.test(text)) {
      ctx.ui.notify("rex-session: Rex's naming instruction changed; check the tab-naming rewrite", "warning");
    }
    guidance = text.replace(SESSION_NAMING, TAB_NAMING);
  });

  // A section rather than a rewritten prompt: the text never changes, so the
  // prompt cache survives.
  pi.on("before_agent_start", (event) => {
    if (guidance) event.systemPromptOptions.sections.rex = guidance;
  });
}

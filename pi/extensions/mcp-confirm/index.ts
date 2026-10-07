import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Asks before any MCP tool call that its server doesn't mark read-only, so the
// model can't post to Slack (or write elsewhere) without a human yes. Codemode
// script calls pass through tool_call too, so they are gated the same way.
// Hints are the server's claim, not verified; a missing hint means "may write".
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!event.toolName.startsWith("mcp__")) return;
    const tool = pi.getAllTools().find((t) => t.name === event.toolName);
    if (tool?.annotations?.readOnlyHint === true) return;

    if (!ctx.hasUI) {
      return { block: true, reason: `${event.toolName} may modify data and needs confirmation, but no UI is available` };
    }
    const input = "input" in event ? event.input : undefined;
    const ok = await ctx.ui.confirm(`Allow ${event.toolName}?`, JSON.stringify(input, null, 2));
    if (!ok) return { block: true, reason: `User declined ${event.toolName}` };
  });
}

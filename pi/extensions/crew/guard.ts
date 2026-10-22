import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkBash, checkWritePath } from "./guard-policy.ts";

// Loaded only into crew worker children (`-e guard.ts`), never the parent.
export default function (pi: ExtensionAPI) {
  const root = process.env.PI_CREW_ROOT;
  pi.on("tool_call", (event, ctx) => {
    if (!root) return { block: true, reason: "PI_CREW_ROOT is not set; refusing tool calls" };
    const input = event.input as Record<string, unknown>;
    let reason: string | null = null;
    if (event.toolName === "edit" || event.toolName === "write") {
      reason = checkWritePath(root, ctx.cwd, input.path);
    } else if (event.toolName === "bash") {
      reason = checkBash(String(input.command ?? ""));
    }
    return reason ? { block: true, reason } : undefined;
  });
}

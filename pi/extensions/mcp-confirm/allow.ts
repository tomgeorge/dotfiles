import { readFileSync } from "node:fs";

/** Tool-name patterns: exact names, or a prefix ending in "*". */
export function loadAllowlist(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { tools?: unknown };
  if (!Array.isArray(raw.tools) || raw.tools.some((t) => typeof t !== "string" || !t.startsWith("mcp__"))) {
    throw new Error(`${path}: "tools" must be a list of mcp__ tool names or prefixes ending in *`);
  }
  return raw.tools as string[];
}

export const allowed = (patterns: string[], tool: string) =>
  patterns.some((p) => (p.endsWith("*") ? tool.startsWith(p.slice(0, -1)) : tool === p));

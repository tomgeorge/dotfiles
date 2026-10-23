import { readFileSync } from "node:fs";

/** Tool-name patterns: exact names, or a prefix ending in "*". */
export function loadAllowlist(path: string): string[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const tools = typeof raw === "object" && raw !== null && "tools" in raw ? raw.tools : undefined;
  if (!Array.isArray(tools) || !tools.every((t): t is string => typeof t === "string" && t.startsWith("mcp__"))) {
    throw new Error(`${path}: "tools" must be a list of mcp__ tool names or prefixes ending in *`);
  }
  return tools;
}

/** Whether a tool name matches any allowlist pattern. */
export function allowed(patterns: string[], tool: string): boolean {
  return patterns.some((p) => (p.endsWith("*") ? tool.startsWith(p.slice(0, -1)) : tool === p));
}

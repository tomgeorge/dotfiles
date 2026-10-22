// Extract friction signals from recent Pi and Claude Code session transcripts.
// Signals are leads, not findings: /retro verifies each against the real
// instruction files before proposing anything. This script never edits.
//
//   node collect.ts [--days 7] [--max 12] [--pi DIR] [--claude DIR]

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type Source = "pi" | "claude";

export interface Ref { file: string; line: number }

export interface Signal {
  kind: "error" | "repeat" | "correction" | "abort";
  source: Source;
  cwd: string;
  ref: Ref;
  tool?: string;
  detail: string;
}

export interface SessionSummary { source: Source; file: string; cwd: string; userMessages: number; toolCalls: number; errors: number }

// Short user messages that push back on what the agent just did.
const CORRECTION = /^\s*(no\b|nope\b|don'?t\b|do not\b|stop\b|actually\b|wait\b|undo\b|revert\b|wrong\b|that'?s (wrong|not)|not what|i said\b|i meant\b|why did you\b|you (didn'?t|forgot|should|shouldn'?t)\b|instead\b)/i;

// Claude Code records a tool call the user declined as a failed tool_result with this preamble.
const REJECTED = /^(Error: )?The user doesn't want to proceed with this tool use\./;
const USER_SAID = /the user said:\n([\s\S]*)$/;

const clip = (s: string, n = 160) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join(" ");
};

function describeCall(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const detail = a.command ?? a.path ?? a.file_path ?? a.pattern ?? a.query ?? "";
  return clip(`${name} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`, 140);
}

interface Call { name: string; args: string; desc: string; ref: Ref }

/** Parse one transcript. Unknown lines are skipped, never fatal. Events stamped before sinceMs are ignored. */
export function analyze(file: string, text: string, source: Source, sinceMs = 0): { summary: SessionSummary; signals: Signal[] } {
  const summary: SessionSummary = { source, file, cwd: "", userMessages: 0, toolCalls: 0, errors: 0 };
  const signals: Signal[] = [];
  const calls = new Map<string, Call>();
  const seen = new Map<string, { count: number; call: Call }>();
  const lines = text.split("\n");

  let inWindow = true;
  const onCall = (id: string, name: string, args: unknown, line: number) => {
    const call: Call = { name, args: JSON.stringify(args ?? {}), desc: describeCall(name, args), ref: { file, line } };
    calls.set(id, call); // even before the window, so a result inside it can name its call
    if (!inWindow) return;
    summary.toolCalls++;
    const key = `${name} ${call.args}`;
    const prev = seen.get(key);
    seen.set(key, { count: (prev?.count ?? 0) + 1, call: prev?.call ?? call });
  };
  const onResult = (id: string, isError: boolean, content: unknown, line: number) => {
    if (!isError || !inWindow) return;
    const call = calls.get(id);
    const text = textOf(content) || String(content ?? "");
    if (source === "claude" && REJECTED.test(text)) {
      // A bare rejection is followed by an "[Request interrupted …]" message, which records the interrupt.
      const said = USER_SAID.exec(text)?.[1];
      if (said) onUser(said, line);
      return;
    }
    summary.errors++;
    signals.push({ kind: "error", source, cwd: summary.cwd, ref: { file, line }, tool: call?.name, detail: `${call?.desc ?? "?"} → ${clip(text)}` });
  };
  const onUser = (text: string, line: number) => {
    if (!inWindow) return;
    if (!text.trim() || text.startsWith("<") || text.startsWith("Task: ")) return;
    summary.userMessages++;
    if (/\[Request interrupted by user/.test(text)) {
      signals.push({ kind: "abort", source, cwd: summary.cwd, ref: { file, line }, detail: "user interrupted the agent" });
    } else if (text.length < 400 && CORRECTION.test(text)) {
      signals.push({ kind: "correction", source, cwd: summary.cwd, ref: { file, line }, detail: clip(text, 240) });
    }
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    let e: any;
    try { e = JSON.parse(raw); } catch { return; }
    if (!e || typeof e !== "object") return;
    if (source === "pi" && e.type === "session" && typeof e.cwd === "string") summary.cwd = e.cwd;
    if (source === "claude" && typeof e.cwd === "string" && !summary.cwd) summary.cwd = e.cwd;
    // Long-running sessions keep old events in a recently modified file.
    const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    inWindow = !(sinceMs && at < sinceMs);
    if (source === "pi") {
      if (e.type !== "message" || !e.message) return;
      const m = e.message;
      if (m.role === "user") onUser(textOf(m.content), line);
      if (m.role === "assistant") {
        for (const p of Array.isArray(m.content) ? m.content : []) if (p?.type === "toolCall") onCall(p.id, p.name, p.arguments, line);
        if (m.stopReason === "aborted" && inWindow) signals.push({ kind: "abort", source, cwd: summary.cwd, ref: { file, line }, detail: "user aborted the agent mid-response" });
      }
      if (m.role === "toolResult") onResult(m.toolCallId, m.isError === true, m.content, line);
    } else {
      const content = e.message?.content;
      if (e.type === "assistant" && Array.isArray(content)) {
        for (const p of content) if (p?.type === "tool_use") onCall(p.id, p.name, p.input, line);
      }
      if (e.type === "user") {
        // A subagent's transcript opens with the parent agent's prompt, not the user's.
        if (typeof content === "string") { if (!e.isSidechain) onUser(content, line); }
        else if (Array.isArray(content)) {
          const results = content.filter((p) => p?.type === "tool_result");
          for (const p of results) onResult(p.tool_use_id, p.is_error === true, p.content, line);
          if (!results.length && !e.isMeta && !e.isSidechain) onUser(textOf(content), line);
        }
      }
    }
  });

  for (const { count, call } of seen.values()) {
    if (count >= 3) signals.push({ kind: "repeat", source, cwd: summary.cwd, ref: call.ref, tool: call.name, detail: `${count}× identical call: ${call.desc}` });
  }
  for (const s of signals) s.cwd ||= summary.cwd;
  return { summary, signals };
}

function walk(dir: string, sinceMs: number, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, sinceMs, out);
    else if (entry.name.endsWith(".jsonl")) {
      let mtime;
      try { mtime = statSync(path).mtimeMs; } catch { continue; } // dangling symlink
      if (mtime >= sinceMs) out.push(path);
    }
  }
  return out;
}

/** "bash cd ~/x && FOO=1 npm run lint --fix" -> "npm run": the part that identifies the habit. */
export function commandShape(desc: string, tool?: string): string {
  let cmd = tool && desc.startsWith(`${tool} `) ? desc.slice(tool.length + 1) : desc;
  // Drop leading `cd dir &&` / `cd dir;` hops and VAR=value assignments, which every command shares.
  for (let prev = ""; prev !== cmd;) {
    prev = cmd;
    cmd = cmd.replace(/^\s*cd\s+\S+\s*(&&|;)\s*/, "").replace(/^\s*[A-Z_][A-Z0-9_]*=\S*\s+/, "");
  }
  return cmd.split(/\s+/).filter(Boolean).slice(0, 2).join(" ") || desc;
}

/** Group recurring errors so one bad habit across sessions stands out. */
export function clusterErrors(signals: Signal[]): { key: string; count: number; sessions: number; example: Signal }[] {
  const groups = new Map<string, Signal[]>();
  for (const s of signals.filter((x) => x.kind === "error")) {
    const key = `${s.tool ?? "?"}: ${commandShape(s.detail.split(" → ")[0], s.tool)}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, count: list.length, sessions: new Set(list.map((s) => s.ref.file)).size, example: list[0] }))
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.sessions - a.sessions || b.count - a.count);
}

export function report(summaries: SessionSummary[], signals: Signal[], days: number, max: number): string {
  const home = homedir();
  const short = (p: string) => p.replace(home, "~");
  const ref = (r: Ref) => `${short(r.file)}:${r.line}`;
  const totals = summaries.reduce((t, s) => ({ u: t.u + s.userMessages, c: t.c + s.toolCalls, e: t.e + s.errors }), { u: 0, c: 0, e: 0 });
  const lines = [
    `# Agent friction signals, last ${days} days`,
    "",
    `${summaries.length} sessions (${summaries.filter((s) => s.source === "pi").length} Pi, ${summaries.filter((s) => s.source === "claude").length} Claude Code) · ${totals.u} user messages · ${totals.c} tool calls · ${totals.e} failed tool calls`,
    "",
    "Signals are leads. Verify each one against the real files before proposing a change.",
  ];
  const section = (title: string, items: string[]) => {
    lines.push("", `## ${title}`, ...(items.length ? items.slice(0, max) : ["(none)"]));
    if (items.length > max) lines.push(`(+${items.length - max} more)`);
  };
  section("Recurring errors (same tool and command shape, 2+ times)", clusterErrors(signals)
    .map((g) => `- ${g.count}× in ${g.sessions} session(s): ${g.key} · e.g. ${g.example.detail} · ${ref(g.example.ref)}`));
  section("Corrections and pushback from the user", signals.filter((s) => s.kind === "correction")
    .map((s) => `- "${s.detail}" · cwd ${short(s.cwd)} · ${ref(s.ref)}`));
  section("Repeated identical tool calls (3+ in a session)", signals.filter((s) => s.kind === "repeat")
    .map((s) => `- ${s.detail} · ${ref(s.ref)}`));
  section("Interrupts", signals.filter((s) => s.kind === "abort").map((s) => `- ${s.detail} · cwd ${short(s.cwd)} · ${ref(s.ref)}`));
  section("All failed tool calls", signals.filter((s) => s.kind === "error").map((s) => `- ${s.detail} · ${ref(s.ref)}`));
  return lines.join("\n");
}

function main(argv: string[]) {
  const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const days = Number(opt("days", "7"));
  const max = Number(opt("max", "12"));
  if (!(days > 0) || !(max > 0)) throw new Error("--days and --max must be positive numbers");
  const since = Date.now() - days * 86_400_000;
  const roots: [Source, string][] = [
    ["pi", opt("pi", join(homedir(), ".pi", "agent", "sessions"))],
    ["claude", opt("claude", join(homedir(), ".claude", "projects"))],
  ];
  const summaries: SessionSummary[] = [];
  const signals: Signal[] = [];
  for (const [source, root] of roots) {
    for (const file of walk(root, since)) {
      const result = analyze(file, readFileSync(file, "utf8"), source, since);
      summaries.push(result.summary);
      signals.push(...result.signals);
    }
  }
  console.log(report(summaries, signals, days, max));
}

// Node reports the main module's real path in import.meta.url, but argv[1] keeps the
// symlink (~/.pi/agent/retro is one), so compare real paths.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));

// Count steering-file usage across pi and Claude Code transcripts.
// Usage: node .agent/plans/steering-audit-usage.mjs [--exclude <session file>...] > usage.tsv
// Codemode counts are tool names referenced in scripts, not confirmed executions.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const H = homedir();
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".jsonl") ? [p] : [];
});

const templates = {
  "review-loop": "Run a review-fix loop on target",
  "rex-crew": "You are the planner of a crew",
  execplan: "write a new ExecPlan as described below",
  retro: null, checkin: null,
};
for (const n of ["retro", "checkin"]) {
  const body = readFileSync(`${H}/git/dotfiles/pi/prompts/${n}.md`, "utf8").split("---").slice(2).join("---");
  templates[n] = body.split("\n").map((l) => l.trim()).find((l) => l.length > 30 && !l.includes("$"));
}

const exclude = new Set(process.argv.flatMap((a, i, all) => (all[i - 1] === "--exclude" ? [a] : [])));
const seen = new Set(); // entry ids already counted, so forked or replayed entries count once
const validName = /^[a-z0-9][a-z0-9-]*$/;
const counts = {}; // kind:name -> {all, recent, last, sessions:Set}
const now = Date.parse("2026-11-26T23:59:00Z");
const bump = (kind, name, ts, sid) => {
  if (!name || (kind === "skill" && !validName.test(name))) return;
  const k = `${kind}\t${name}`;
  const c = (counts[k] ??= { all: 0, recent: 0, last: "", sessions: new Set() });
  c.all++; c.sessions.add(sid);
  if (ts && now - Date.parse(ts) < 30 * 864e5) c.recent++;
  if (ts && ts > c.last) c.last = ts;
};
const skillFromPath = (p) => p?.match(/skills\/([^/]+)\/SKILL\.md/)?.[1];
const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x.text ?? "").join(" ") : "";

function onCall(name, args, ts, sid, src) {
  bump("tool", name, ts, sid);
  const p = args?.path ?? args?.file_path;
  if (/^(read|Read)$/.test(name) && skillFromPath(p)) bump("skill", skillFromPath(p), ts, sid);
  if (name === "bash" || name === "Bash") {
    const s = skillFromPath(args?.command); if (s && /\b(cat|sed|head|less)\b/.test(args.command)) bump("skill", s, ts, sid);
    const m = args?.command?.match(/(?:^|[;&|(]\s*)(hey|rex|ketch|gh|terminal-browser|chainctl)\b/g);
    for (const x of new Set(m ?? [])) bump("cli", x.replace(/^[;&|(\s]+/, ""), ts, sid);
  }
  if (name === "Skill") bump("skill", args?.skill ?? args?.command, ts, sid);
  if (name === "agent_spawn") bump("agent", args?.agent ?? "(default)", ts, sid);
  if (name === "subagent") bump("agent", "subagent-tool", ts, sid);
  if (name === "codemode") for (const m of (args?.code ?? "").matchAll(/tools\.([a-zA-Z_]+)\(/g)) bump("codemode-tool", m[1], ts, sid);
}

for (const [src, dir] of [["pi", `${H}/.pi/agent/sessions`], ["claude", `${H}/.claude/projects`]]) {
  for (const f of walk(dir)) {
    if (exclude.has(f)) continue;
    const sid = `${src}:${f}`;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const m = e.message; const ts = e.timestamp;
      if (!m) continue;
      const key = e.id ?? e.uuid;
      if (key) { if (seen.has(`${src}:${key}`)) continue; seen.add(`${src}:${key}`); }
      if (m.role === "user") {
        const t = textOf(m.content);
        for (const [n, sig] of Object.entries(templates)) if (sig && t.includes(sig)) bump("prompt", n, ts, sid);
        for (const x of t.matchAll(/<skill name="([^"]+)"/g)) bump("skill", x[1], ts, sid);
        for (const x of t.matchAll(/<command-name>\/?([^<]+)<\/command-name>/g)) bump("command", x[1], ts, sid);
        const slash = t.match(/^\/([a-z][a-z-]+)/); if (slash) bump("command", slash[1], ts, sid);
      }
      if (Array.isArray(m.content)) for (const c of m.content) {
        if (c.type === "toolCall") onCall(c.name, c.arguments, ts, sid, src);
        if (c.type === "tool_use") onCall(c.name, c.input, ts, sid, src);
      }
    }
  }
}

const rows = Object.entries(counts).map(([k, v]) => [...k.split("\t"), v.all, v.sessions.size, v.recent, v.last.slice(0, 10)]);
rows.sort((a, b) => a[0].localeCompare(b[0]) || b[2] - a[2]);
console.log(["kind", "name", "calls", "sessions", "last30d", "last"].join("\t"));
for (const r of rows) console.log(r.join("\t"));

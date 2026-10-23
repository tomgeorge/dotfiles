import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskReport } from "./handoff.ts";

export interface ModelRef { provider: string; model: string }

export interface CrewConfig {
  slug: string;
  goal: string;
  repoRoot: string;
  repoName: string;
  commonDir: string;
  /** Workers branch from here and the harness merges into it. Never main. */
  integrationBranch: string;
  integrationPath: string;
  baseSha: string;
  workerModel: ModelRef;
  reviewerModel: ModelRef;
  maxConcurrent: number;
  budgetUsd: number;
  taskTimeoutMin: number;
  /** Minutes without ANY stream event before the planner is told a worker may be stuck. */
  stallMin: number;
  createdAt: number;
}

export type TaskStatus =
  | "running" | "submitted" | "integrated" | "conflict" | "failed" | "cancelled" | "timeout" | "interrupted";

export interface TaskRecord {
  id: number;
  kind: "implement" | "review";
  title: string;
  spec: string;
  acceptance: string[];
  checks: string[];
  paths: string[];
  reviewOf?: number;
  model: string;
  branch?: string;
  worktree?: string;
  base?: string;
  /** The worker's pi session file: its full transcript, thinking and tool calls included. */
  session?: string;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  cost: number;
  toolCalls: number;
  activity: string;
  lastEventAt: number;
  stallReported?: boolean;
  report?: TaskReport;
}

export interface CrewState {
  version: 1;
  config: CrewConfig;
  status: "active" | "stopped" | "finished";
  tasks: TaskRecord[];
  nextId: number;
  budgetReported?: boolean;
  summary?: string;
}

const crewDir = (commonDir: string) => join(commonDir, "pi-crew");
const statePath = (commonDir: string, slug: string) => join(crewDir(commonDir), `${slug}.json`);
export const sessionPath = (commonDir: string, slug: string, id: number) => join(crewDir(commonDir), slug, `t${id}.jsonl`);

export function saveState(state: CrewState): void {
  const path = statePath(state.config.commonDir, state.config.slug);
  mkdirSync(crewDir(state.config.commonDir), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

export function loadState(commonDir: string, slug: string): CrewState {
  const state = JSON.parse(readFileSync(statePath(commonDir, slug), "utf8")) as CrewState;
  if (state.version !== 1) throw new Error(`Unsupported crew state version ${state.version}`);
  return state;
}

/** Crews for this repo, newest first. */
export function listCrews(commonDir: string): CrewState[] {
  const dir = crewDir(commonDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"))
    // A corrupt or newer-version ledger must not hide the other crews.
    .map((f) => { try { return loadState(commonDir, f.slice(0, -5)); } catch { return undefined; } })
    .filter((s): s is CrewState => !!s)
    .sort((a, b) => b.config.createdAt - a.config.createdAt);
}

export const spent = (state: CrewState) => state.tasks.reduce((sum, t) => sum + t.cost, 0);
export const runningTasks = (state: CrewState) => state.tasks.filter((t) => t.status === "running");
export const money = (usd: number) => `$${usd.toFixed(2)}`;
export const ref = (m: ModelRef) => `${m.provider}/${m.model}`;

export function slugify(text: string): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return `${base || "crew"}-${Date.now().toString(36).slice(-4)}`;
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};

/** Compact ledger for the planner and /crew-status. */
export function formatStatus(state: CrewState, now = Date.now()): string {
  const c = state.config;
  const lines = [
    `Crew ${c.slug} (${state.status}) · integration branch ${c.integrationBranch} at ${c.integrationPath}`,
    `spent ${money(spent(state))} of ${money(c.budgetUsd)} · ${runningTasks(state).length}/${c.maxConcurrent} running`,
  ];
  if (!state.tasks.length) lines.push("No tasks yet.");
  for (const t of state.tasks) {
    const time = t.status === "running" ? `${ago(now - t.startedAt)}, last event ${ago(now - t.lastEventAt)} ago` : ago((t.endedAt ?? now) - t.startedAt);
    const extra = t.status === "running" ? ` · ${t.toolCalls} tools · ${t.activity}` : "";
    const review = t.reviewOf ? ` of #${t.reviewOf}` : "";
    lines.push(`#${t.id} ${t.kind}${review} [${t.status}] "${t.title}" · ${t.model} · ${time} · ${money(t.cost)}${extra}`);
  }
  return lines.join("\n");
}

/** The widget below the editor while a crew runs. `hint` says how to open the panel. */
export function formatWidget(state: CrewState, hint: string, now = Date.now()): string[] {
  const c = state.config;
  const running = runningTasks(state);
  const lines = [`crew ${c.slug} · ${running.length}/${c.maxConcurrent} running · ${money(spent(state))}/${money(c.budgetUsd)} · ${hint}`];
  for (const t of running) {
    const secs = Math.round((now - t.startedAt) / 1000);
    const quiet = Math.round((now - t.lastEventAt) / 1000);
    lines.push(` #${t.id} ${t.kind.padEnd(9)} ${String(Math.floor(secs / 60)).padStart(3)}m${String(secs % 60).padStart(2, "0")}s  ${String(t.toolCalls).padStart(3)} tools  ${money(t.cost)}  ${quiet > 60 ? `(quiet ${quiet}s) ` : ""}${t.activity}`.slice(0, 160));
  }
  return lines;
}

import { execFile } from "node:child_process";
import { Transcript } from "../crew/transcript.ts";
import type { Progress } from "./runner.ts";

// Session-lifetime record of every job, for the widget and the /subagents popup.
// Pure state: no Pi imports, so it's testable with node --test.

export type JobStatus = "running" | "ok" | "error" | "cancelled";

export interface GitInfo {
  branch: string;
  /** cwd is in a linked worktree, not the main checkout. */
  worktree: boolean;
}

export interface LogEntry {
  /** Milliseconds since the job started. */
  at: number;
  text: string;
}

export interface JobRecord {
  id: number;
  provider: string;
  model: string;
  task: string;
  cwd: string;
  tools: string[];
  started: number;
  ended?: number;
  status: JobStatus;
  progress: Progress;
  /** `null` once looked up and cwd isn't a git checkout; `undefined` while pending. */
  git?: GitInfo | null;
  log: LogEntry[];
  /** The child's conversation as it streams: thinking, text, and tool calls with results. */
  transcript: Transcript;
  result?: string;
  error?: string;
}

export const LOG_LIMIT = 200;

export class JobStore {
  private readonly jobs = new Map<number, JobRecord>();
  private readonly listeners = new Set<() => void>();

  add(job: Omit<JobRecord, "status" | "log" | "ended" | "transcript">): JobRecord {
    const record: JobRecord = { ...job, status: "running", log: [], transcript: new Transcript() };
    this.jobs.set(job.id, record);
    this.emit();
    return record;
  }

  update(id: number, progress: Progress, now = Date.now()) {
    const job = this.jobs.get(id);
    if (!job) return;
    // One log line per tool call; usage/phase updates don't add noise.
    if (progress.toolCalls > job.progress.toolCalls) {
      job.log.push({ at: now - job.started, text: progress.activity });
      if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
    }
    job.progress = progress;
    this.emit();
  }

  /** One raw event from the child's JSON stream. */
  event(id: number, event: Record<string, unknown>) {
    const job = this.jobs.get(id);
    if (!job) return;
    const before = job.transcript.version;
    job.transcript.applyEvent(event);
    if (job.transcript.version !== before) this.emit();
  }

  setGit(id: number, git: GitInfo | null) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.git = git;
    this.emit();
  }

  finish(id: number, status: Exclude<JobStatus, "running">, outcome: { result?: string; error?: string }, now = Date.now()) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = status;
    job.ended = now;
    job.result = outcome.result;
    job.error = outcome.error;
    this.emit();
  }

  get(id: number) { return this.jobs.get(id); }
  list(): JobRecord[] { return [...this.jobs.values()].sort((a, b) => a.id - b.id); }
  running(): JobRecord[] { return this.list().filter((job) => job.status === "running"); }

  /** Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

/** Branch and worktree for display. `null` when cwd isn't a git checkout or git fails. */
export function readGitInfo(cwd: string): Promise<GitInfo | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD", "--path-format=absolute", "--git-dir", "--git-common-dir"],
      { timeout: 2000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
      (error, stdout) => {
        if (error) return resolve(null);
        const [branch, gitDir, commonDir] = stdout.trim().split("\n");
        if (!branch || !gitDir || !commonDir) return resolve(null);
        resolve({ branch, worktree: gitDir !== commonDir });
      },
    );
  });
}

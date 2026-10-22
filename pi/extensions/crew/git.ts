import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { CheckResult } from "./handoff.ts";

// Harness commits must never block on a signing prompt (stdin is closed).
export const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

export interface GitResult { code: number; stdout: string; stderr: string }

export function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...GIT_ENV } },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
        resolve({ code, stdout, stderr });
      });
  });
}

export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export interface RepoInfo {
  root: string;
  /** Shared .git directory; crew state lives here so it is outside every working tree. */
  commonDir: string;
  name: string;
  head: string;
  dirty: boolean;
}

/** The shared .git directory, without needing a commit (status commands use this). */
export async function commonDirOf(cwd: string): Promise<string> {
  return (await gitOk(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
}

export async function repoInfo(cwd: string): Promise<RepoInfo> {
  const root = (await gitOk(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const commonDir = (await gitOk(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  const head = (await gitOk(cwd, ["rev-parse", "HEAD"])).trim();
  const dirty = (await gitOk(cwd, ["status", "--porcelain"])).trim() !== "";
  // The main worktree's directory name, even when called from a linked worktree.
  const name = basename(commonDir) === ".git" ? basename(dirname(commonDir)) : basename(root);
  return { root, commonDir, name, head, dirty };
}

/** ~/git/worktrees/<repo>/<branch with / replaced by ->, per the global convention. */
export const worktreePath = (repo: string, branch: string) =>
  join(homedir(), "git", "worktrees", repo, branch.replaceAll("/", "-"));

export async function addWorktree(repoRoot: string, path: string, branch: string, base: string): Promise<void> {
  await gitOk(repoRoot, ["worktree", "add", "-b", branch, path, base]);
}

export async function removeWorktree(repoRoot: string, path: string, branch?: string): Promise<void> {
  await git(repoRoot, ["worktree", "remove", "--force", path]);
  if (branch) await git(repoRoot, ["branch", "-D", branch]);
}

/** Commit anything left uncommitted. Returns true if a commit was made. */
export async function commitAll(cwd: string, message: string): Promise<boolean> {
  if (!(await gitOk(cwd, ["status", "--porcelain"])).trim()) return false;
  await gitOk(cwd, ["add", "-A"]);
  await gitOk(cwd, ["commit", "-q", "-m", message]);
  return true;
}

export interface BranchFacts { head: string; commits: string[]; diffStat: string; files: string[] }

export async function branchFacts(cwd: string, base: string): Promise<BranchFacts> {
  const head = (await gitOk(cwd, ["rev-parse", "HEAD"])).trim();
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    head,
    commits: lines(await gitOk(cwd, ["log", "--oneline", "--no-decorate", `${base}..HEAD`])),
    diffStat: await gitOk(cwd, ["diff", "--stat", `${base}..HEAD`]),
    files: lines(await gitOk(cwd, ["diff", "--name-only", `${base}..HEAD`])),
  };
}

/** One-line commits on `branch` since `base`; needs no worktree, so it works after a crash or /crew-clean. */
export async function branchCommits(cwd: string, base: string, branch: string): Promise<string[]> {
  return (await gitOk(cwd, ["log", "--oneline", "--no-decorate", `${base}..${branch}`]))
    .split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Paths with uncommitted changes (tracked or untracked, not ignored). */
export async function dirtyFiles(cwd: string): Promise<string[]> {
  // -z: no quoting of odd names; a rename's entry is followed by its old path, which we skip.
  const entries = (await gitOk(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"])).split("\0");
  const files: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    files.push(entries[i].slice(3));
    if (/^[RC]/.test(entries[i])) i++;
  }
  return files;
}

/** Revert the worktree to HEAD. Returns what was dirty, so callers can report it. */
export async function discardChanges(cwd: string): Promise<string[]> {
  const files = await dirtyFiles(cwd);
  if (files.length) {
    await gitOk(cwd, ["reset", "-q", "--hard", "HEAD"]);
    // -ff: a check that ran `git init fixture` leaves a nested repo that a single -f skips.
    await gitOk(cwd, ["clean", "-q", "-ffd"]);
    const left = await dirtyFiles(cwd);
    if (left.length) throw new Error(`could not restore ${cwd}; still dirty: ${left.join(", ")}`);
  }
  return files;
}

export async function diffText(cwd: string, base: string, maxBytes: number): Promise<string> {
  const diff = await gitOk(cwd, ["diff", `${base}..HEAD`]);
  return diff.length > maxBytes ? `${diff.slice(0, maxBytes)}\n[diff truncated at ${maxBytes} bytes]` : diff;
}

/** Files outside every prefix in `paths`. Empty `paths` means unrestricted. */
export function outsidePaths(files: string[], paths: string[]): string[] {
  if (!paths.length) return [];
  // A glob segment widens to its directory: "src/*.ts" allows everything under src/.
  const prefixes = paths.map((p) => {
    const segments = p.replace(/^\.\//, "").split("/");
    const glob = segments.findIndex((s) => /[*?[{]/.test(s));
    return glob === -1 ? segments.join("/") : segments.slice(0, glob).join("/") + "/";
  });
  if (prefixes.includes("/")) return []; // a top-level glob like "*.md" restricts nothing we can check
  return files.filter((f) => !prefixes.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`)));
}

export interface MergeResult { ok: boolean; conflicts: string[]; output: string }

/** Merge `branch` into the branch checked out at `cwd`; abort cleanly on conflict. */
export async function mergeBranch(cwd: string, branch: string, message: string): Promise<MergeResult> {
  const r = await git(cwd, ["merge", "--no-ff", "--no-edit", "-m", message, branch]);
  if (r.code === 0) return { ok: true, conflicts: [], output: r.stdout };
  const conflicts = (await git(cwd, ["diff", "--name-only", "--diff-filter=U"])).stdout.split("\n").filter(Boolean);
  await git(cwd, ["merge", "--abort"]);
  return { ok: false, conflicts, output: (r.stdout + r.stderr).trim() };
}

/** Run a shell check; keep only the tail so failures don't flood the planner's context. */
export function runCheck(cwd: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, ...GIT_ENV },
    });
    let out = "";
    let timedOut = false;
    let done = false;
    let drain: ReturnType<typeof setTimeout> | undefined;
    const keep = (chunk: Buffer) => { out = (out + chunk.toString("utf8")).slice(-16_384); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    // Kill the whole process group: test runners spawn their own children.
    const kill = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ } };
    const finish = (exit: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(drain);
      signal?.removeEventListener("abort", stop);
      kill(); // background jobs the check left behind would pile up across checks
      // A daemon that left the process group can hold the pipes open forever; stop reading.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ command, exit, tail: out.split("\n").slice(-30).join("\n"), timedOut });
    };
    // exit is null on timeout or abort, so it can never read as a pass.
    const stop = () => finish(null);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (error) => { out += error.message; finish(null); });
    // "close" waits for every pipe holder; after the shell exits, give output a moment to drain.
    child.on("exit", (code) => { clearTimeout(timer); drain = setTimeout(() => finish(code), 500); });
    child.on("close", (code) => finish(code));
  });
}

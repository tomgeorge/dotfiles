import { spawn } from "node:child_process";
import { constants } from "node:os";
import type { RunResult } from "./watcher.ts";

// Keep the end of each stream: reports only show the tail, and a chatty check
// shouldn't grow without bound.
const MAX_STREAM = 256 * 1024;
const KILL_GRACE_MS = 2_000;

/**
 * Run `bash -c command` in its own process group. Pi's `exec` signals only bash,
 * which leaves the check's children (`gh run watch`, `sleep`, ...) running after a
 * watch stops or Pi exits; killing the group takes them too. Background
 * processes a check leaves behind are killed when it exits, for the same reason.
 */
export function runCheck(command: string, cwd: string, signal: AbortSignal, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    let exited = false;
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString();
      return next.length > MAX_STREAM ? next.slice(-MAX_STREAM) : next;
    };
    proc.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

    const signalGroup = (sig: NodeJS.Signals) => {
      if (proc.pid === undefined) return;
      try { process.kill(-proc.pid, sig); } catch (error) {
        // ESRCH: the group is already gone.
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = () => {
      if (killed) return;
      killed = true;
      signalGroup("SIGTERM");
      forceTimer = setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
      forceTimer.unref();
    };
    const timer = setTimeout(kill, timeoutMs);
    signal.addEventListener("abort", kill, { once: true });
    if (signal.aborted) kill();

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
    };
    proc.on("error", (error) => { cleanup(); reject(error); });
    proc.on("exit", () => {
      exited = true;
      // Leftover group members would otherwise hold stdout open and delay "close".
      signalGroup("SIGKILL");
    });
    proc.on("close", (code, sig) => {
      cleanup();
      if (forceTimer && exited) clearTimeout(forceTimer);
      const signalCode = sig ? 128 + (constants.signals[sig] ?? 0) : 1;
      resolve({ code: code ?? signalCode, stdout, stderr, killed });
    });
  });
}

// Child-only extension: loaded with -e by runner.ts when a job requests the
// `git` tool. Never loaded by the parent (directory extensions load index.ts).
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildGitArgv, GIT_ENV } from "./git-policy.ts";

const TIMEOUT_MS = 60_000;
// Stop reading a runaway command (e.g. `log -p` over all history) rather than
// buffering it; the model sees the head plus a note to narrow the query.
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

function runGit(argv: string[], cwd: string, signal?: AbortSignal) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; capped: boolean }>((resolve, reject) => {
    const env = { ...process.env, ...GIT_ENV };
    // An inherited external diff would bypass --no-ext-diff for plumbing paths.
    delete env.GIT_EXTERNAL_DIFF;
    const child = spawn("git", argv, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let size = 0;
    let capped = false;
    let stderr = "";
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(kill, TIMEOUT_MS);
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (capped) return;
      size += chunk.length;
      out.push(chunk);
      if (size > MAX_CAPTURE_BYTES) { capped = true; kill(); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8192); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) return reject(new Error("git cancelled"));
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr, capped });
    });
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "git",
    label: "git (read-only)",
    description: `Run a read-only git command in the working directory. Pass the arguments after "git", e.g. ["log", "--oneline", "-5", "--", "path"]. Allowed: blame, branch/tag (listing only), cat-file, describe, diff, for-each-ref, grep, log, ls-files, ls-tree, merge-base, name-rev, reflog (show), rev-list, rev-parse, shortlog, show, show-ref, status. No network, pager, external diff, textconv, or file output. Output is truncated to ${DEFAULT_MAX_LINES} lines / ${DEFAULT_MAX_BYTES / 1024} KiB; the full output is saved to a temp file.`,
    parameters: Type.Object({
      args: Type.Array(Type.String(), { minItems: 1, description: "Arguments after `git`; the first is the subcommand" }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const argv = buildGitArgv(params.args);
      const { code, stdout, stderr, capped } = await runGit(argv, ctx.cwd, signal);
      // Exit 1 is "no match"/"not an ancestor" for grep, merge-base, etc.
      if (code !== 0 && !(code === 1 && !stderr.trim())) {
        throw new Error(`git ${params.args[0]} exited ${code}: ${stderr.trim() || "(no stderr)"}`);
      }
      const truncated = truncateHead(stdout || (code === 1 ? "(exit 1, no output)" : "(no output)"));
      let text = truncated.content;
      if (truncated.truncated || capped) {
        const dir = await mkdtemp(join(tmpdir(), "pi-subagent-git-"));
        const file = join(dir, "output.txt");
        await writeFile(file, stdout, { mode: 0o600 });
        text += `\n\n[Output truncated${capped ? " (command stopped at 32 MiB)" : ""}. Full captured output: ${file}]`;
      }
      return { content: [{ type: "text", text }], details: undefined };
    },
  });
}

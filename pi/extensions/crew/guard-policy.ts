import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// Guardrails for worker children, not a sandbox: bash can still reach anything
// the user can. They stop the common accidents (editing the user's checkout,
// pushing, moving branches) that would break the one-writer-per-worktree model.

/** Resolve symlinks on the longest existing prefix so a link can't smuggle a write out. */
function realish(path: string): string {
  let existing = path;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...rest);
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** A reason to block an edit/write to `path`, or null to allow it. */
export function checkWritePath(root: string, cwd: string, path: string): string | null {
  if (typeof path !== "string" || !path.trim()) return "missing path";
  const expanded = path.replace(/^@/, "").replace(/^~(?=$|\/)/, homedir());
  const target = realish(resolve(cwd, expanded));
  const realRoot = realish(root);
  if (!inside(realRoot, target)) return `${path} is outside this worker's worktree (${root})`;
  const rel = relative(realRoot, target);
  if (rel === ".git" || rel.startsWith(`.git${sep}`)) return "editing .git is not allowed";
  return null;
}

const DENIED_GIT: [RegExp, string][] = [
  [/\bgit\b[^|;&\n]*\bpush\b/, "git push"],
  [/\bgit\b[^|;&\n]*\bworktree\b/, "git worktree"],
  [/\bgit\b[^|;&\n]*\bremote\b/, "git remote"],
  [/\bgit\b[^|;&\n]*\b(switch|rebase|update-ref|filter-branch|filter-repo)\b/, "moving or rewriting branches"],
  [/\bgit\b[^|;&\n]*\bcheckout\s+(-[bB]|--orphan|--detach)\b/, "switching branches"],
  [/\bgit\b[^|;&\n]*\bbranch\s+(-[dDmMfc]|--delete|--move|--force)\b/, "changing branches"],
  [/\bgit\b[^|;&\n]*\breset\s+--hard\b/, "git reset --hard"],
  [/\bgit\b[^|;&\n]*\bconfig\b/, "git config"],
  [/\bgit\b[^|;&\n]*\bcommit\b[^|;&\n]*--amend\b/, "amending commits"],
];

/** A reason to block a bash command, or null to allow it. */
export function checkBash(command: string): string | null {
  for (const [pattern, what] of DENIED_GIT) {
    if (pattern.test(command)) return `${what} is not allowed for crew workers; the harness owns branches and merges`;
  }
  return null;
}

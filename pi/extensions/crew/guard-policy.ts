import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Guardrails for worker children, not a sandbox: bash can still reach anything
// the user can. They stop the common accidents (editing the user's checkout,
// pushing, moving branches) that would break the one-writer-per-worktree model.

/**
 * Resolve an absolute path the way the kernel will when a file is written there:
 * walk it one component at a time from the root, substitute every symlink
 * (dangling or not) with its target relative to the *real* directory holding it,
 * and resolve ".." physically against the real path so far. Components that don't
 * exist yet are kept as plain names; Pi creates them with mkdir -p.
 */
function physical(abs: string): string {
  let todo = abs.split(sep).filter(Boolean);
  let cur = sep;
  let hops = 0;
  let missing = false;
  while (todo.length) {
    const part = todo.shift()!;
    if (part === ".") continue;
    if (part === "..") {
      cur = dirname(cur);
      continue;
    }
    const next = join(cur, part);
    if (!missing) {
      let stat;
      try {
        stat = lstatSync(next);
      } catch {
        missing = true;
      }
      if (stat?.isSymbolicLink()) {
        if (++hops > 40) throw new Error("too many levels of symlinks");
        const target = readlinkSync(next);
        if (isAbsolute(target)) cur = sep;
        todo = [...target.split(sep).filter(Boolean), ...todo];
        continue;
      }
    }
    cur = next;
  }
  return cur;
}

// Must match how Pi's own tools turn a path argument into a file (utils/paths.js
// normalizePath + resolvePath), or the guard checks one file and the tool writes another.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
function piResolve(path: string, cwd: string): string {
  let p = path.replace(UNICODE_SPACES, " ");
  if (p.startsWith("@")) p = p.slice(1);
  // join, not resolve: Pi turns "~//abs" into $HOME/abs, not /abs.
  if (p === "~") p = homedir();
  else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  if (/^file:\/\//.test(p)) p = fileURLToPath(p);
  return resolve(cwd, p);
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** A reason to block an edit/write to `path`, or null to allow it. */
export function checkWritePath(root: string, cwd: string, path: string): string | null {
  if (typeof path !== "string" || !path.trim()) return "missing path";
  let target: string;
  try {
    target = physical(piResolve(path, cwd));
  } catch (error) {
    return `can't resolve ${path}: ${(error as Error).message}`;
  }
  const realRoot = physical(resolve(root));
  if (!inside(realRoot, target)) return `${path} is outside this worker's worktree (${root})`;
  const rel = relative(realRoot, target);
  // APFS is case-insensitive by default: ".GIT/config" is .git/config.
  if (rel.split(sep)[0].toLowerCase() === ".git") return "editing .git is not allowed";
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

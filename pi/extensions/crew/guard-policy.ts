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
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** A reason to block an edit/write to `path`, or null to allow it. */
export function checkWritePath(root: string, cwd: string, path: unknown): string | null {
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

// The bash check works on shell words, not on the raw line: judging git's subcommand and exact
// argument words keeps branch names like crew/fix-git-push-t2 and messages like "Load remote
// config" or "Document --amend" from tripping it, while quoting, attached option values,
// redirections, and $(...) can't hide a denied call. Regexes over the raw line kept missing
// spellings and one backtracked exponentially. This is a lexer, not a shell: it fails closed on
// what it can't follow. Every loop advances, so the cost is linear in the input.

const MAX_COMMAND = 100_000;
const MAX_DEPTH = 16;
/** Stands in for a $(...) or `...` word part; its contents are judged as a separate command. */
const SUB = "\u0000";

interface Lexed { commands: string[][]; error?: string }

function lex(src: string): Lexed {
  const commands: string[][] = [];
  let i = 0;
  let error: string | undefined;

  const readHeredocs = (pending: { delim: string; strip: boolean }[]) => {
    for (const { delim, strip } of pending) {
      while (i < src.length) {
        const end = src.indexOf("\n", i);
        const line = src.slice(i, end === -1 ? src.length : end);
        i = end === -1 ? src.length : end + 1;
        if ((strip ? line.replace(/^\t+/, "") : line) === delim) break;
      }
    }
    pending.length = 0;
  };

  // Parses until `close` (")" or "`") or the end; returns false on an error.
  function parse(close: string | undefined, depth: number): boolean {
    if (depth > MAX_DEPTH) { error = "nesting too deep"; return false; }
    let words: string[] = [];
    let word: string | undefined;
    let dropNext = false; // the next word is a redirection target
    const heredocs: { delim: string; strip: boolean }[] = [];
    let heredocNext: { strip: boolean } | undefined;
    const endWord = () => {
      if (word === undefined) return;
      if (heredocNext) heredocs.push({ delim: word, strip: heredocNext.strip }), heredocNext = undefined;
      else if (dropNext) dropNext = false;
      else words.push(word);
      word = undefined;
    };
    const endCommand = () => {
      endWord();
      if (words.length) commands.push(words);
      words = [];
    };
    const substitution = (closer: string): boolean => {
      if (!parse(closer, depth + 1)) return false;
      word = (word ?? "") + SUB;
      return true;
    };
    while (i < src.length) {
      const c = src[i];
      if (close && c === close) { i++; endCommand(); return true; }
      if (c === " " || c === "\t") { endWord(); i++; continue; }
      if (c === "\n") { endCommand(); i++; readHeredocs(heredocs); continue; }
      if (c === "#" && word === undefined) { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")") { endCommand(); i++; continue; }
      if (c === "<" || c === ">") {
        if (src.startsWith("<<", i) && !src.startsWith("<<<", i)) {
          endWord();
          i += 2;
          const strip = src[i] === "-";
          if (strip) i++;
          heredocNext = { strip };
          continue;
        }
        // "2>&1": the fd number is part of the operator, not a word.
        if (word !== undefined && /^\d+$/.test(word)) word = undefined;
        endWord();
        while (i < src.length && "<>&|".includes(src[i])) i++;
        dropNext = true;
        continue;
      }
      if (c === "\\") { word = (word ?? "") + (src[i + 1] ?? ""); i += 2; continue; }
      if (c === "'") {
        const end = src.indexOf("'", i + 1);
        if (end === -1) { error = "unterminated quote"; return false; }
        word = (word ?? "") + src.slice(i + 1, end);
        i = end + 1;
        continue;
      }
      if (c === "$" && src[i + 1] === "(") { i += 2; if (!substitution(")")) return false; continue; }
      if (c === "`") { i++; if (!substitution("`")) return false; continue; }
      if (c === '"') {
        i++;
        word ??= "";
        for (;;) {
          if (i >= src.length) { error = "unterminated quote"; return false; }
          const d = src[i];
          if (d === '"') { i++; break; }
          if (d === "\\") { word += src[i + 1] ?? ""; i += 2; continue; }
          if (d === "$" && src[i + 1] === "(") {
            i += 2;
            if (!parse(")", depth + 1)) return false;
            word += SUB;
            continue;
          }
          if (d === "`") {
            i++;
            if (!parse("`", depth + 1)) return false;
            word += SUB;
            continue;
          }
          word += d;
          i++;
        }
        continue;
      }
      word = (word ?? "") + c;
      i++;
    }
    if (close) { error = "unterminated substitution"; return false; }
    endCommand();
    return true;
  }

  parse(undefined, 0);
  return { commands, error };
}

// Global options that take the next word as their value.
const VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);

const DENIED_SUBCOMMANDS: Record<string, string> = {
  push: "git push", worktree: "git worktree", remote: "git remote", config: "git config",
  switch: "moving or rewriting branches", rebase: "moving or rewriting branches", "update-ref": "moving or rewriting branches",
  "filter-branch": "moving or rewriting branches", "filter-repo": "moving or rewriting branches",
};

const isGit = (w: string) => w === "git" || w.endsWith("/git");
const hasShortFlag = (args: string[], letters: string) =>
  args.some((a) => /^-[A-Za-z]+$/.test(a) && [...a.slice(1)].some((ch) => letters.includes(ch)));

function deniedGit(words: string[]): string | null {
  // The first git word: also catches `xargs git push` and `env git push`.
  const start = words.findIndex(isGit);
  if (start === -1) return null;
  const configs: string[] = [];
  let i = start + 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (VALUE_OPTIONS.has(w)) {
      if (w === "-c" || w === "--config-env") configs.push(words[i + 1] ?? "");
      i++;
    } else if (w.startsWith("-c") && !w.startsWith("--")) configs.push(w.slice(2));
    else if (w.startsWith("--config-env=")) configs.push(w.slice(13));
    else if (!w.startsWith("-")) break;
  }
  // An inline alias (`-c alias.p=push p`) hides the real subcommand.
  if (configs.some((c) => /^alias\./i.test(c))) return "defining git aliases";
  const sub = words[i];
  if (sub === undefined) return null;
  if (sub.includes(SUB) || sub.includes("$")) return "a git subcommand computed at run time";
  if (DENIED_SUBCOMMANDS[sub]) return DENIED_SUBCOMMANDS[sub];
  const args = words.slice(i + 1);
  if (sub === "checkout") {
    // Only the path form (`git checkout [<tree>] -- <paths>`) leaves HEAD alone; `git checkout main --` switches.
    const dashes = args.indexOf("--");
    const switching = hasShortFlag(args.slice(0, dashes === -1 ? args.length : dashes), "bB")
      || args.some((a) => a === "--orphan" || a.startsWith("--orphan=") || a === "--detach");
    if (dashes === -1 || dashes === args.length - 1 || switching) return "switching branches (use git restore for files)";
  }
  if (sub === "branch" && (hasShortFlag(args, "dDmMfcC") || args.some((a) => ["--delete", "--move", "--force", "--copy"].includes(a)))) {
    return "changing branches";
  }
  if (sub === "reset" && args.includes("--hard")) return "git reset --hard";
  if (sub === "commit" && args.includes("--amend")) return "amending commits";
  return null;
}

/** A reason to block a bash command, or null to allow it. */
export function checkBash(command: string): string | null {
  const why = (what: string) => `${what} is not allowed for crew workers; the harness owns branches and merges`;
  if (command.length > MAX_COMMAND) return /\bgit\b/.test(command) ? "command too long to inspect for git; split it up" : null;
  const { commands, error } = lex(command);
  for (const words of commands) {
    const what = deniedGit(words);
    if (what) return why(what);
  }
  // Fail closed only where it matters: an unparseable line that may run git.
  if (error && /\bgit\b/.test(command)) return `can't inspect this command safely (${error}); simplify the git call`;
  return null;
}

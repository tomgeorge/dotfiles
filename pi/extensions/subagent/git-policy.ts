// Read-only git policy for subagent children. Kept free of Pi imports so
// `node --test` can exercise it directly, like runner.ts.

// Subcommands that only read repository state. Anything else (fetch, checkout,
// commit, config, worktree, format-patch, ...) is rejected outright.
const READ_SUBCOMMANDS = new Set([
  "blame", "branch", "cat-file", "describe", "diff", "for-each-ref", "grep",
  "log", "ls-files", "ls-tree", "merge-base", "name-rev", "reflog", "rev-list",
  "rev-parse", "shortlog", "show", "show-ref", "status", "tag",
]);

// Options that write files or run configured programs. Matched as the whole
// token or as `--opt=value`; `-O` is also matched as a prefix (`-Oless`).
const FORBIDDEN_OPTIONS = new Set([
  "--output", "--output-directory", "--ext-diff", "--textconv", "--filters",
  "--open-files-in-pager", "--exec", "--upload-pack", "--receive-pack",
]);

// Injected so repo or user config can't run external diff/textconv drivers.
const NO_EXEC_FLAGS: Record<string, string[]> = {
  diff: ["--no-ext-diff", "--no-textconv"],
  log: ["--no-ext-diff", "--no-textconv"],
  show: ["--no-ext-diff", "--no-textconv"],
  grep: ["--no-textconv"],
  blame: ["--no-textconv"],
};

// branch/tag create, move, or delete refs unless listing. Only listing options
// are allowed, and `--list` is forced so positionals are patterns, not new refs.
const LIST_OPTIONS: Record<string, Set<string>> = {
  branch: new Set([
    "-l", "--list", "-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose",
    "--contains", "--no-contains", "--merged", "--no-merged", "--points-at",
    "--sort", "--format", "--column", "--no-column", "--color", "--no-color",
    "-i", "--ignore-case", "--omit-empty", "--abbrev", "--no-abbrev",
  ]),
  tag: new Set([
    "-l", "--list", "--contains", "--no-contains", "--merged", "--no-merged",
    "--points-at", "--sort", "--format", "--column", "--no-column", "--color",
    "--no-color", "-i", "--ignore-case", "--omit-empty",
  ]),
};

// reflog expire/delete/drop rewrite logs; bare `reflog` and `reflog show` read.
const READ_REFLOG_ACTIONS = new Set(["show", "exists"]);

// Global options placed before the subcommand. core.fsmonitor would run a
// hook on index refresh; protocol.allow blocks lazy fetches in partial clones.
export const GIT_GLOBAL_ARGS = [
  "--no-pager", "-c", "core.fsmonitor=false", "-c", "core.pager=cat",
  "-c", "protocol.allow=never",
] as const;

export const GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0", // keep `status` from rewriting the index
  GIT_NO_LAZY_FETCH: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
} as const;

function optionName(arg: string): string {
  const eq = arg.indexOf("=");
  return eq === -1 ? arg : arg.slice(0, eq);
}

/** Validate `git <args>` and return the full argv to run, or throw. */
export function buildGitArgv(args: readonly string[]): string[] {
  if (!args.length) throw new Error("git: a subcommand is required");
  const [sub, ...rest] = args;
  if (!READ_SUBCOMMANDS.has(sub)) {
    throw new Error(`git ${sub}: not allowed; read-only subcommands: ${[...READ_SUBCOMMANDS].join(", ")}`);
  }
  for (const arg of rest) {
    if (arg.includes("\0")) throw new Error("git: arguments must not contain NUL");
    const name = optionName(arg);
    if (FORBIDDEN_OPTIONS.has(name) || /^-O/.test(arg)) throw new Error(`git ${sub}: option ${name} is not allowed`);
  }

  const allowed = LIST_OPTIONS[sub];
  if (allowed) {
    for (const arg of rest) {
      if (arg === "--") break;
      if (!arg.startsWith("-")) continue;
      if (!allowed.has(optionName(arg))) {
        throw new Error(`git ${sub}: only listing options are allowed (got ${arg}); pass values as --opt=value`);
      }
    }
  }
  if (sub === "reflog" && rest.length && !rest[0].startsWith("-") && !READ_REFLOG_ACTIONS.has(rest[0])) {
    throw new Error(`git reflog ${rest[0]}: not allowed; use reflog show`);
  }

  const forced = [...(NO_EXEC_FLAGS[sub] ?? []), ...(allowed ? ["--list"] : [])];
  return [...GIT_GLOBAL_ARGS, sub, ...forced, ...rest];
}

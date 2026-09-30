# One-shot subagent

One explicit job → fresh Pi process → result. No agent personas, shared conversation,
workflow engine, recursive delegation, or automatic model selection.

## Install

`link.sh` links this directory to `~/.pi/agent/extensions/subagent`. For just this
extension (without relinking other dotfiles):

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi/extensions/subagent" ~/.pi/agent/extensions/subagent
```

Run `/reload` in Pi afterward. Requires `pi` on PATH (the same version as the parent).
No additional dependencies.

## Use

```text
/subagent
/subagent anthropic/claude-sonnet-4-6 Review src/auth.ts for security problems
/subagent-cancel      # cancel all running jobs
/subagent-cancel 2    # cancel job #2
```

With no arguments, select an authenticated model and enter a task. With arguments,
use an exact `provider/model` ID; model IDs may themselves contain slashes. The
command uses the current working directory and all reading tools, including `git`. It does
not change the parent model. In interactive mode the job runs in the background, so
you can keep chatting. Results appear in chat and become parent context;
when idle, returning a result does not trigger an additional parent model call.

Each job gets a number (`#1`, `#2`, ...). While it runs, its status-bar line shows elapsed time, the child's tool-call count,
and its latest tool call. Tool-launched jobs also stream this line into the tool row.
The parent agent's turn still waits for a tool-launched job, as for any tool call.

The parent can also call the `subagent` tool when you request/approve delegation:

```json
{
  "task": "Review src/auth.ts for security problems",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "cwd": "/absolute/path/to/project",
  "tools": ["read", "grep", "find", "ls", "git"]
}
```

`git` is optional. When requested, the child loads `git-read.ts` with `-e`, which
registers a `git` tool taking the arguments after `git` as an array. `git-policy.ts`
decides what may run:

- Only read subcommands: blame, cat-file, describe, diff, for-each-ref, grep, log,
  ls-files, ls-tree, merge-base, name-rev, rev-list, rev-parse, shortlog, show,
  show-ref, status, `reflog` (show/exists), and `branch`/`tag` with listing options
  only (`--list` is forced, so positionals are patterns, never new refs).
- Rejected options: `--output*`, `--ext-diff`, `--textconv`, `--filters`,
  `--open-files-in-pager`/`-O`, `--exec`, `--upload-pack`, `--receive-pack`.
- Always applied: `--no-pager`, `core.fsmonitor=false`, `protocol.allow=never`,
  `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_LAZY_FETCH=1`, and `--no-ext-diff`/`--no-textconv`
  where the subcommand supports them.

Configured clean/smudge filters (e.g. Git LFS) can still run when `diff` or `status`
compares the working tree; that is the same trust boundary as the configuration
itself. Output is capped like other results; runaway commands stop at 32 MiB.

Up to 5 jobs run at once per parent session, from either entry point. The agent can
issue several `subagent` calls in one turn and they run in parallel. Requests over
the limit fail rather than queue. Change the limit with the `--subagent-max-concurrent`
flag or the `PI_SUBAGENT_MAX_CONCURRENT` environment variable (the flag wins):

```sh
pi --subagent-max-concurrent 3
PI_SUBAGENT_MAX_CONCURRENT=8 pi
```

Each job has a 20-minute timeout. `/subagent-cancel` cancels jobs from either
entry point; Pi's normal tool cancellation also aborts tool-launched jobs.
Shutdown/reload cancels all children. SIGTERM escalates to SIGKILL after one second.

## Boundaries

- No parent conversation or session is copied; put needed context in the task.
- Children use Pi's existing authentication, model catalog, and context files
  (`AGENTS.md` / `CLAUDE.md`). Global Pi settings/system prompts still apply.
- Extensions, skills, and prompt-template discovery are disabled, except for the
  extensions in `CHILD_EXTENSIONS` (`runner.ts`), which are loaded with `-e`. It
  includes `npm:@gotgenes/pi-anthropic-auth`, without which Anthropic subscription
  auth fails with a 400 ("Third-party apps now draw from your extra usage"). Project-local
  resources are declined with `--no-approve`; no trust decision is auto-approved.
- Startup network updates are disabled with `--offline`; model requests still run.
- Unavailable model IDs fail, never intentionally fall back. Extension-only
  providers are unsupported unless their extension is added to `CHILD_EXTENSIONS`.
- Only `read`, `grep`, `find`, `ls`, and read-only `git` are exposed. No bash,
  editing, worktree creation, commits, fetches, or recursion. This is **not an OS security sandbox**: reading
  can reach outside `cwd`, and Pi configuration itself can execute credential helpers.
- The runner returns `ok`, `error`, or `cancelled`. The Pi tool adapter throws on
  failure so Pi marks it as a failed tool call; commands display an error.
- Results are capped at 2000 lines / 50 KiB. Oversized successful answers are saved
  to a private temporary directory, with the file path included in the result.
  These files are not automatically removed by the extension.
- No persistent child session or full event transcript is retained.

## Checks

```sh
node --test pi/extensions/subagent/*.test.ts
bash -n link.sh
```

Tests use local Node subprocesses, not paid model calls. The runner is separate
from Pi registration so process behavior can be tested without loading Pi.

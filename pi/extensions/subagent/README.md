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
/subagent-cancel [label|number|all]
```

With no arguments, select an authenticated model and enter a task. With arguments,
use an exact `provider/model` ID; model IDs may themselves contain slashes. The
command uses the current working directory and all four reading tools. It does
not change the parent model. Results appear in chat and become parent context;
when idle, returning a result does not trigger an additional parent model call.

The parent can also call the `subagent` tool when you request/approve delegation:

```json
{
  "label": "auth-review",
  "task": "Review src/auth.ts for security problems",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "cwd": "/absolute/path/to/project",
  "tools": ["read", "grep", "find", "ls"]
}
```

To run jobs in parallel, the parent makes several `subagent` calls in the same
turn; Pi runs sibling tool calls concurrently. Up to 10 jobs run at once per
parent session; set `PI_SUBAGENT_MAX_CONCURRENT` to change the limit (invalid
values fall back to 10 with a warning). Requests over the limit fail rather than
queue. Each job has a five-minute timeout.

The parent names each tool job with `label`: 1–64 lowercase letters, digits, or
hyphens, not `all` or only digits, and unique among running jobs. Jobs started
with `/subagent` are named `job-<number>`. Numbers are never reused in a session.
A widget above the editor lists running jobs with a spinner and elapsed time.

`/subagent-cancel auth-review` or `/subagent-cancel 3` cancels one job, and
`/subagent-cancel all` cancels every job. With no argument it cancels the only
running job, or opens a picker when several are running (cancels all without a
UI). Cancelling one job fails only that tool call. Pi's normal tool cancellation
(Esc) aborts all tool-launched jobs in the turn. Shutdown/reload cancels every
child. SIGTERM escalates to SIGKILL after one second.

While idle, Pi waits for a `/subagent` command to finish before handling further
input, including `/subagent-cancel`; commands run immediately while the parent
is mid-turn.

Each parallel job is a separate paid model session and a separate `pi` process.

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
- Only `read`, `grep`, `find`, and `ls` are exposed. No bash, editing, worktree
  creation, commits, or recursion. This is **not an OS security sandbox**: reading
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

Tests use local Node subprocesses, not paid model calls. The runner and job
registry are separate from Pi registration so they can be tested without
loading Pi.

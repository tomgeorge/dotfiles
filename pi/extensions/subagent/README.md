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
/subagent-cancel
```

With no arguments, select an authenticated model and enter a task. With arguments,
use an exact `provider/model` ID; model IDs may themselves contain slashes. The
command uses the current working directory and all four reading tools. It does
not change the parent model. Results appear in chat and become parent context;
when idle, returning a result does not trigger an additional parent model call.

The parent can also call the `subagent` tool when you request/approve delegation:

```json
{
  "task": "Review src/auth.ts for security problems",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "cwd": "/absolute/path/to/project",
  "tools": ["read", "grep", "find", "ls"]
}
```

Only one job runs at a time per parent session. Additional requests fail rather
than queue. Each job has a five-minute timeout. `/subagent-cancel` cancels either
entry point; Pi's normal tool cancellation also aborts tool-launched jobs.
Shutdown/reload cancels the child. SIGTERM escalates to SIGKILL after one second.

## Boundaries

- No parent conversation or session is copied; put needed context in the task.
- Children use Pi's existing authentication, model catalog, and context files
  (`AGENTS.md` / `CLAUDE.md`). Global Pi settings/system prompts still apply.
- Extensions, skills, and prompt-template discovery are disabled. Project-local
  resources are declined with `--no-approve`; no trust decision is auto-approved.
- Startup network updates are disabled with `--offline`; model requests still run.
- Unavailable model IDs fail, never intentionally fall back. Extension-only
  providers are unsupported because child extensions are disabled.
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
node --test pi/extensions/subagent/runner.test.ts
bash -n link.sh
```

Tests use local Node subprocesses, not paid model calls. The runner is separate
from Pi registration so process behavior can be tested without loading Pi.

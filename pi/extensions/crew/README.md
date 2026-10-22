# Crew

This is an experimental "subagent v2". It turns your Pi session into a **planner** that delegates
coding work to **workers**, each in its own git worktree. Workers hand results back, and each
handoff wakes the planner, so it keeps work moving without you prompting it.

The design is a scaled-down version of the planner/worker/handoff design from Cursor's
[Towards self-driving codebases](https://cursor.com/blog/self-driving-codebases), adjusted with
lessons from Cognition, Anthropic, Factory, and Gas Town. There is one planner, at most a handful
of workers, and no recursive subplanners.

It is independent of the [`subagent`](../subagent/) extension, which stays read-only and one-shot.

## Use

```text
/crew <goal>       # start: pick worker and reviewer models, concurrency, and budget
/crew-status       # ledger: tasks, status, spend, liveness
/crew-stop         # cancel running workers (worktrees kept) and leave planner mode
/crew-resume [slug]  # resume a stopped or interrupted crew in this repo
/crew-clean        # delete the worktrees and branches of finished tasks
```

`/crew` creates an integration branch `crew/<slug>` from `HEAD`, with a worktree at
`~/git/worktrees/<repo>/crew-<slug>`. When the planner finishes, you review that branch and
merge it yourself. Nothing is ever pushed or merged into your branch.

Uncommitted changes in your checkout are not included. `/crew` warns you about them.

Before merging, `/review-loop crew` (from [`pi/prompts`](../../prompts/review-loop.md)) can review
the integration branch with three reviewers that share no context, fix what they find, and
repeat. Its fixes are left uncommitted in the integration worktree.

## How it works

| Role | Who | Can | Can't |
|---|---|---|---|
| Planner | Your session in crew mode | `read` `grep` `find` `ls`, plus `crew_*` tools | Edit, run bash, run tests, merge by hand |
| Worker | Fresh `pi -p` per task, in a new worktree on `crew/<slug>-t<N>` | Read, edit, write, bash, commit | Write outside its worktree, push, switch, rebase, or amend branches |
| Reviewer | Fresh read-only `pi -p` on a task's worktree | Read the code; gets the diff and spec, not the author's narrative | Edit |
| Harness | This extension | Creates worktrees, runs checks, merges, enforces caps | Make decisions |

Planner tools:

- `crew_dispatch`: start an `implement` or `review` task in the background and return at once.
  You can set acceptance criteria, `checks` (shell commands), and `paths` (scope).
- `crew_integrate`: the harness runs `git merge --no-ff` into the integration branch. On a
  conflict it aborts and lists the files, and the planner sends a repair worker. After a clean
  merge it re-runs the task's checks on the integration branch. That re-run reports failures
  but doesn't block.
- `crew_status`, `crew_cancel`, and `crew_wake` (a check-in the planner schedules for itself).
- `crew_finish`: runs the given checks on the integration branch and **refuses to finish if any
  fail**. This makes the final full test run a harness rule, not a prompt request; in testing,
  the planner skipped it when it was only asked to.

### Handoffs

A worker's final message must contain a fenced `handoff` block. It holds a status, summary, notes,
concerns, deviations, findings, and suggested next steps. The harness then adds facts it observed
itself:
- commits and diff stat;
- files changed outside the declared `paths`;
- whether it had to commit work the worker left uncommitted;
- each check command's exit code and output tail.

The planner receives the handoff as a follow-up message that starts a turn if it's idle. The
message keeps the worker's claims and the harness's observations in separate sections.

### Liveness

- **Liveness:** any stream event counts, including thinking deltas. A watchdog that counts only
  content tokens kills healthy reasoning models.
- **Possible stall:** after `stallMin` (10) minutes with no events at all, the planner gets a
  "possible stall" message and decides what to do. The harness doesn't kill the worker.
- **Hard timeout:** the per-task timeout (45 minutes, adjustable per task) kills the worker's
  process group. Its partial output and worktree are kept and reported in a handoff.

### Budget

The harness sums provider-reported spend across workers; the planner's own spend isn't counted.
At the budget, new dispatches are refused and the planner is told once. Running workers finish.

## State

The ledger is stored at `<git-common-dir>/pi-crew/<slug>.json`, outside every working tree, and
survives restarts. When the session ends, running workers are killed and marked `interrupted`.
`/crew-resume` reloads the ledger and wakes the planner. Interrupted tasks keep their worktrees
and branches.

## Limits

- **Guardrails, not a sandbox.** Edit and write calls are confined to the worker's worktree, and
  symlinks are resolved. Bash has a small denylist: `git push`, `worktree`, `remote`, `switch`,
  `rebase`, `reset --hard`, `config`, and `commit --amend`. Beyond that, workers run arbitrary
  shell commands as you, with your network and credentials. Only use `/crew` on code and
  commands you'd let an agent run unattended.
- **Some state is shared.** Worktrees share the git object store, global caches, and fixed ports.
  Projects that need per-checkout setup, such as `node_modules` or `.env`, need workers to do
  that setup themselves; say so in the spec or add it to the check commands.
- **No cross-session children.** Workers are tied to the session, so closing Pi stops them.
- **Workers don't see each other.** One worker never sees another's unmerged changes. The planner
  sequences overlapping work or sends repair tasks.
- **Ledger can drift.** A task may stay `submitted` after you finish its work by hand. Recover
  with `/crew-status`, re-dispatch, or `/crew-clean`.
- **One crew per session**, and planner spend isn't budgeted.

## Checks

```sh
node --test pi/extensions/crew/*.test.ts
```

The tests use fake child processes and temporary git repositories, with no paid model calls.
An end-to-end RPC driver was used during development. It ran the full dispatch, handoff,
integrate, conflict, repair, review, and finish loop on a toy repository with
`anthropic/claude-sonnet-5-5` for about $0.12.

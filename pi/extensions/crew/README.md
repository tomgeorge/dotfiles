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
/crew              # no goal: open the panel of the current or last unfinished crew
/crew-status       # open the crew panel; prints the text ledger in print mode
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

## Panel

`ctrl+shift+c` or `/crew-status` opens a panel over the session, on the crew in this session or
else the newest one in this repository's ledger. `/crew` with no goal does the same for an
unfinished crew.

```text
 Crew add-theme-2zw1 active · Add a lazygit-like theme to every panel
 crew/add-theme-2zw1 · 2/3 running · $1.13/$10.00 █░░░░░░░░░
 worker anthropic/claude-sonnet · reviewer same
┌─ Tasks 4 ──────────────────────────────────────┐┌─ #2 implement Port the widget ─────────────────┐
│ ● #1 Add the theme    4m10s  $0.41  integrated ││ [1 Overview] 2 Spec 3 Handoff 4 Checks 5 Diff  │
│▸⠋ #2 Port the widget  3m20s  $0.38  edit src/w…││ status       running                           │
│ ⠋ #3 Port the panel   3m20s  $0.22  quiet 2m ·…││ kind         implement                         │
│ ✓ #4 Review #1          40s  $0.12  submitted  ││ model        anthropic/claude-sonnet           │
│                                                ││ branch       crew/add-theme-2zw1-t2            │
└────────────────────────────────────────────────┘└────────────────────────────────────── 1-11/15 ─┘
```

The list shows each task's status, kind, title, elapsed time, cost, and activity. A running task
with no stream event for over a minute shows `quiet 2m` in the warning colour, and in the error
colour once it passes `stallMin`. The details pane has five tabs:

1. **Overview**: status, model, branch, base, worktree, timings, cost, tool count, paths, acceptance.
2. **Spec**: the spec the worker received.
3. **Handoff**: the worker's claims and what the harness observed, as separate sections.
4. **Checks**: each check's verdict. Failing output starts open; `enter` opens or closes one.
5. **Diff**: `git diff <base>..<branch>`. A review shows the diff of the task it reviews.

| Key | Action |
|---|---|
| type, `/` | Filter by title, id, status, kind, or branch |
| `j`/`k`, arrows | Move; in the details, scroll |
| `enter`, `l` / `h` | Focus the details / back to the list |
| `tab`, `1`-`5` | Switch tab |
| `ctrl+d`/`ctrl+u` | Page the details |
| `ctrl+o` | Zoom the details to the full panel |
| `x` | Cancel the selected running task, after a `y` to confirm. Its handoff wakes the planner |
| `o` | Copy the selected task's worktree path |
| `?` | Help |
| `esc` | Clear the filter, then close |

The panel is read-only apart from `x`: integrating and dispatching stay with the planner. While
the crew runs in this session, the panel reads its in-memory state, which is fresher than the
ledger for running tasks. A crew from the ledger is re-read every 2 seconds. Diffs are loaded
only for the task and tab on screen, and cached per branch tip. The panel never waits on the
planner, so handoffs keep waking it while the panel is open.

`ctrl+shift+c` needs a terminal that reports modifier keys (kitty keyboard protocol, as in
Ghostty). On Linux, many terminals bind it to copy; use `/crew` there.

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
  the planner skipped it when it was only asked to. It also refuses if the checks modified files
  (`npm install`, `lint --fix`), since the pass then depends on changes that aren't committed. The
  harness reverts the integration worktree after every check run.

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
  `rebase`, `reset --hard`, `config`, `commit --amend`, inline aliases, and branch-switching
  `checkout` or `branch` forms. It reads shell words, so it sees through quoting and `$(...)`,
  but not through `eval`, variables, or scripts written to disk. Beyond that, workers run arbitrary
  shell commands as you, with your network and credentials. Only use `/crew` on code and
  commands you'd let an agent run unattended.

  The write check is check-then-write: a worker that swaps a symlink between the guard's check
  and the write (say, from a background process) can write outside its worktree. So can any
  bash command. The guard catches mistakes, not a worker set on escaping. Closing that takes an
  OS sandbox around each worker, which also has to cover the shared `.git` directory and the
  network; that's future work.
- **Some state is shared.** Worktrees share the git object store, global caches, and fixed ports.
  Projects that need per-checkout setup, such as `node_modules` or `.env`, need workers to do
  that setup themselves; say so in the spec or add it to the check commands.
- **No cross-session children.** Workers are tied to the session, so closing Pi stops them.
- **Workers don't see each other.** One worker never sees another's unmerged changes. The planner
  sequences overlapping work or sends repair tasks.
- **Ledger can drift.** A task may stay `submitted` after you finish its work by hand. Recover
  with `/crew-status`, re-dispatch, or `/crew-clean`.
- **One crew per session**, and planner spend isn't budgeted.

## Follow-ups

- **Live worker output.** The panel only has each worker's `activity` and counters. A live tail
  needs a bounded ring buffer of stream events per worker, filled in `handle` in `worker.ts` and
  passed up through `onProgress`.
- **Crew workers in `/subagents`.**
- **Better slugs.** `slugify` uses the goal's opening words (`i-d-like-to-add-a-theme-that-cop-2zw1`).
  Drop filler words, or add `/crew --name`.

## Checks

```sh
node --test pi/extensions/crew/*.test.ts
```

The tests use fake child processes and temporary git repositories, with no paid model calls.
An end-to-end RPC driver was used during development. It ran the full dispatch, handoff,
integrate, conflict, repair, review, and finish loop on a toy repository with
`anthropic/claude-sonnet-5-5` for about $0.12.

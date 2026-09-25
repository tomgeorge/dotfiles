# Plan: parallel subagents

## Goal

Let the parent agent run several subagent jobs at the same time, and let the
user cancel individual jobs. Keep the extension's current boundaries: one job
per child process, read-only tools, no queueing, no workflow engine, and no
recursion.

The main use case is the parent agent calling the `subagent` tool. The
`/subagent` slash command stays as it is, apart from sharing the new job
registry (see "Out of scope").

## Decisions

| Question | Decision |
| --- | --- |
| Concurrency limit | Configurable, default 10 |
| Over the limit | Fail immediately with a clear error; don't queue |
| Job names | The parent names each job with a required `label` tool input |
| Cancellation | Cancel one job by label or number, or cancel all jobs |
| How to run jobs in parallel | The parent makes several `subagent` tool calls in one turn (no batch input) |

### Why no "batch" input

There are two ways to let the parent start several jobs at once:

- **Separate calls (chosen).** The parent makes several `subagent` tool calls
  in one reply. Pi already runs sibling tool calls from the same reply at the
  same time ("preflighted sequentially, then executed concurrently",
  `docs/extensions.md`). Each job gets its own tool result, error status, and
  cancel signal.
- **One batched call (rejected).** Add a `jobs: [...]` parameter so one
  `subagent` call carries several tasks and returns one combined result. That
  would repeat what Pi already does. It also combines N outcomes into one
  result, which makes partial failure, per-job cancel, and output truncation
  harder.

So the only thing stopping parallel jobs today is the single `active` slot in
`index.ts`. `runner.ts` keeps no shared state, so each `runSubagent` call is
already independent.

## Changes

### 1. Job labels

The parent names every job it starts, so the user can see and cancel jobs by
name, for example `/subagent-cancel auth-review`.

- New required tool input: `label`, described as "Short unique name for this
  job, shown to the user and used to cancel it, for example `auth-review`."
- Rules, checked by `validateLabel` in `registry.ts`:
  - Matches `^[a-z0-9][a-z0-9-]{0,63}$`: lowercase letters, digits, and
    hyphens, up to 64 characters. The cap only stops runaway names; the
    parent should still keep labels short. No spaces, so a label works as
    a single command argument.
  - Not `all`, and not only digits. `/subagent-cancel` accepts a label, a
    number, or `all`, so those values would be ambiguous.
  - Unique among **running** jobs. A duplicate fails fast with an error that
    names the running job, so the parent can pick another name. A label is
    free again after its job ends.
- Put the pattern in the TypeBox schema too, so the model sees it.
- The label is used only in the extension. It isn't sent to the child, and
  `Job` and `runner.ts` don't change.
- Jobs started with `/subagent` get the label `job-<id>`.

### 2. `registry.ts` (new, no Pi imports)

A small class that tracks running jobs, so it can be unit-tested without
loading Pi:

```ts
interface Entry {
  id: number; label: string; model: string; startedAt: number;
  controller: AbortController; done: Promise<unknown>;
}
class JobRegistry {
  constructor(max: number)
  add(label: string | undefined, model, controller, done): Entry  // throws when full or label taken
  remove(id): void
  find(ref: string): Entry | undefined  // by label, or by number
  cancel(ref: string): Entry | undefined
  cancelAll(): void
  list(): Entry[]
  size: number
}
export function validateLabel(label: string): void
export function parseMaxConcurrent(value: string | undefined): { max: number; warning?: string }
```

- IDs count up from 1 and are never reused within a session, so an old ID
  can't cancel the wrong job.
- `add` checks the limit and the label's uniqueness, then stores the entry,
  all without an `await`. Pi preflights sibling calls one after another but
  runs them at the same time, so an `await` between the checks and the insert
  could let two jobs take the last slot or the same label. Add a comment
  saying this.

### 3. Configuration

- Environment variable `PI_SUBAGENT_MAX_CONCURRENT`, default `10`.
- Read it once when the extension loads. Accept only a positive integer. On an
  invalid value, fall back to 10 and show a warning at `session_start` (if UI
  is available). Don't throw during load, because that disables the whole
  extension.
- Why an environment variable instead of `pi.registerFlag`: a flag must be
  passed on every `pi` launch, but you can set an environment variable once in
  your shell profile.

### 4. `index.ts`

- Replace `let active` with a `JobRegistry`.
- `run()`: validate the job and label, check the model, then call
  `registry.add(...)` with no `await` in between. Call `registry.remove(id)`
  in `finally`.
- Pass the tool's `label` to `registry.add`. The `/subagent` command passes
  `undefined`.
- Add `label` and `id` to the tool result `details`. Include them in error
  messages (`cancelled: auth-review (#3) cancelled by user`), so the parent
  can tell which job stopped.
- `session_shutdown`: `cancelAll()`, then
  `await Promise.allSettled(list().map((e) => e.done))`.
- Update the tool description: replace "One outstanding job per session" with
  "Up to N concurrent jobs (N from `PI_SUBAGENT_MAX_CONCURRENT`, default 10).
  Put independent tasks in separate `subagent` calls in the same turn so they
  run in parallel. Give each job a short, descriptive, unique `label`." Build
  the string from the actual limit.
- Keep the delegation-approval prompt guideline. Parallel jobs shouldn't
  encourage delegation the user didn't ask for.

### 5. Showing running jobs

The user needs to see job names to cancel a specific job, and to see that
jobs are still alive. This shows liveness only, not what a job is doing.

- Replace the single status entry with a widget (`ctx.ui.setWidget`) listing
  one line per job, with a spinner and elapsed time:
  `⠋ auth-review  #3  anthropic/claude-sonnet-4-6  1m12s`.
  With up to 10 jobs, one status line would be too long.
- Keep a short footer status too: `Subagents: 3 running`.
- Refresh the widget on a timer (about every 100 ms, fast enough for the
  spinner to look smooth) while any job runs. Start the timer when the first
  job is added. Stop it and clear the widget and status when the last job is
  removed and on `session_shutdown`, so no timer outlives the jobs.
- All rows share one spinner frame, driven by the same timer.
- Elapsed time comes from `Entry.startedAt`. Format it with a pure
  `formatElapsed(ms)` in `registry.ts`: `12s` under a minute, then `1m12s`.
- Skip all of this when `ctx.hasUI` is false.

### 6. `/subagent-cancel`

| Input | Behavior |
| --- | --- |
| `/subagent-cancel auth-review` | Cancel that job. Tell the user if it isn't running. |
| `/subagent-cancel 3` | Cancel job #3. |
| `/subagent-cancel all` | Cancel all jobs. |
| `/subagent-cancel` with UI, 1 job | Cancel it. |
| `/subagent-cancel` with UI, 2 or more jobs | Show a picker: "All", then one entry per job. |
| `/subagent-cancel` without UI | Cancel all jobs. |

- Add `getArgumentCompletions` that offers `all` plus the running jobs'
  labels, with the job number and model as the description.
- This works while the parent is mid-turn: during streaming, Pi runs
  extension commands immediately instead of queueing them.
- Cancelling one job makes only that tool call fail. The parent's turn
  continues with the other jobs. Esc still aborts the whole turn, which
  cancels every job through each tool call's signal.

### 7. `README.md`

- Replace "Only one job runs at a time" with the limit, how to configure it,
  the fail-don't-queue rule, labels, and how to cancel.
- Add `label` to the example tool call.
- Add notes on cost and resources. N parallel jobs means N paid model
  sessions and N `pi` processes, each with its own Node runtime.

## Tests

- `registry.test.ts`:
  - `add` fails once the limit is reached and succeeds again after `remove`.
  - `add` rejects a label that's already running and accepts it again after
    that job is removed.
  - `validateLabel` accepts `auth-review` and `a1`. It rejects `""`, `all`,
    `12`, `-x`, `Auth`, `has space`, and a 65-character label.
  - `find`/`cancel` match by label and by number. `cancel` aborts only that
    controller. `cancelAll` aborts all of them.
  - IDs aren't reused after removal. Omitted labels become `job-<id>`.
  - `parseMaxConcurrent`: unset → 10, `"4"` → 4; `"0"`, `"-1"`, `"x"`,
    `"2.5"` → 10 with a warning.
  - `formatElapsed`: `0` → `0s`, `12_000` → `12s`, `60_000` → `1m00s`,
    `72_000` → `1m12s`.
- `runner.test.ts`: start two `runSubagent` calls at once with the existing
  fake child. Check that each resolves `ok` with its own output, and that
  aborting one signal cancels only that job.

## Manual verification

- Ask the parent to run three independent read-only tasks in one turn. The
  widget should show three labelled jobs at once, each with a moving spinner
  and a rising elapsed time. Each result should land in its own tool result.
  The widget should disappear when the last job ends.
- Set `PI_SUBAGENT_MAX_CONCURRENT=2` and ask for three. The third should fail
  fast with the limit error, and the other two should complete.
- While three are running, cancel one by label. Only that job should fail as
  cancelled; the others should finish.
- Run `/subagent-cancel all` and `/reload` while jobs are running. Afterward,
  no children should remain: `pgrep -fl "pi -p --mode json"`.

## Out of scope

- **Parallel jobs from the `/subagent` slash command.** When the parent is
  idle, Pi's interactive loop awaits each command handler, so a running
  `/subagent` command holds all later input, including a second `/subagent`
  or `/subagent-cancel`, until it finishes. This is existing behavior.
  Fixing it means not awaiting the job in the command handler. We're not
  doing that now, because the parent agent is the main caller. The command
  keeps working and uses the shared registry and limit.
- Queueing jobs over the limit, choosing models automatically, and combining
  results.
- Progress reporting: showing each job's current activity (for example, its
  latest tool call), `onUpdate` progress on tool calls, or streaming partial
  answers. The runner still reads only the final answer.

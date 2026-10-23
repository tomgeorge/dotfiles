# Make the crew mutation gate finish: no timers after session shutdown

## Purpose

After this change, `node pi/extensions/test-support/mutate.ts crew` finishes and exits 0, with every mutant in `pi/extensions/crew/mutants.json` killed. Today one mutant, "dispatch launches for a crew stopped during setup", always ends as `ERROR … ETIMEDOUT` after 5 minutes, so the gate can never pass. That makes it useless as a check for crews, goals, or CI.

The root cause is a small real bug in the crew extension, not only in the tests. If a `/crew` or `/crew-resume` command is still waiting for a stopped crew's work when the Pi session shuts down, it finishes after shutdown and calls `activate()`. That restarts the `setInterval` timers that shutdown had just cleared. In a test process, those timers keep Node alive forever. In Pi, they leak a sweep timer and a render timer, and they re-activate a crew in a session that is going away.

You can see it working when the gate prints `all N mutants killed` and exits 0, and the crew test suite still passes.

## Context

These terms are used throughout the plan:

- **Crew extension:** `pi/extensions/crew/index.ts`, a Pi extension that runs a planner agent plus background worker agents. It runs directly under Node 24 type stripping. The repo has no `package.json` or `tsconfig`.
- **Mutation gate:** `pi/extensions/test-support/mutate.ts <extension> [mutant name…]`. It reads `<extension>/mutants.json`, a list of `{ name, file, from, to }` text replacements. It applies each one to a temporary copy of the extension and runs `node --test` on that copy's `*.test.ts` files.
  - A mutant counts as **killed** only if the test run completes with failures.
  - A run that hits `MUTATE_TIMEOUT_MS` (default 300000) counts as **ERROR**. The gate treats that as not killed, because a timeout says nothing about whether the tests noticed the fault.
- **The mutant:** in `pi/extensions/crew/mutants.json` it replaces `if (crew !== state || !isActive()) {\n        endTask(task, "cancelled");` with `if (false) {…`. That disables the check in `crew_dispatch` (around `index.ts:418`) which refuses to launch a worker for a crew that was stopped while its worktree was being set up.
- **Tests that should kill it**, both in `pi/extensions/crew/index.test.ts`:
  - "a dispatch racing /crew-stop is refused rather than started for a stopped crew" (around line 320). It fails quickly under the mutant, as it should.
  - "a dispatch still setting up when the crew stops never launches its worker" (around line 406). Under the mutant it deadlocks. The mutant launches a fake worker. `/crew-resume` then calls `drain(ctx)`, which waits for all pending work, including that worker. The fake worker (`workers()` in the test file) resolves only when finished or aborted, and its abort controller was created after `/crew-stop` aborted everything. The test hits its 20 s `BOUND` timeout.
- **Cleanup after a timeout:** when a test times out, `crewTest`'s `onCancel` cleanup finishes every fake worker and emits `session_shutdown`. Shutdown sets `shuttingDown = true` and calls `stopTimers()`. Now that the worker is finished, the stuck `/crew-resume` continues. It calls `activate()` (`index.ts` around line 189), which runs `sweepTimer = setInterval(sweep, SWEEP_MS)` again. Nothing clears that timer, so the test file never exits, and the mutation gate's `spawnSync` times out.
- **Relevant code in `index.ts`:**
  - `shuttingDown` (around line 123).
  - `activate()` / `deactivate()` / `stopTimers()` (around lines 189–217).
  - `drain()` and `switchCrew()` (around lines 225–245).
  - The `/crew` command, which drains and then activates (around lines 728 and 756).
  - The `/crew-resume` command (around lines 787–803).
  - The `session_shutdown` handler (around line 833).

## Plan of work

### Milestone 1: regression test, red

Goal: a fast unit test that fails on the current code because a crew start or resume that finishes after `session_shutdown` re-activates.

Work: add a test to `pi/extensions/crew/index.test.ts`, following the style of the existing `crewTest` and `BOUND` tests:

1. Keep a dispatched worker running so that `/crew-resume` must wait for it. Use the `ignoreAbort: true` boot option, as the "resuming after a crash…" test does, or another way to make `drain` block.
2. `/crew-stop`, then start `/crew-resume` without awaiting it.
3. Emit `session_shutdown`, then finish the worker, then await the resume.
4. Assert that no crew is active afterwards. Observable signs:
   - No `crew-resume` message was sent after the shutdown (`f.sent`).
   - The crew tools are not active (`f.active()`).
   - `crew_status` either throws "No active crew" or shows the crew as not active.

Pick whichever assertions hold under the fix, and record the choice in the Decision Log. Then check whether the timer leak itself is observable directly. One option is to stub `globalThis.setInterval` for the duration of the test and count live intervals. If it is, assert it as well.

Result and proof: running only the new test fails on the current code:
`node --no-warnings --test --test-name-pattern="<new test name>" pi/extensions/crew/index.test.ts`

### Milestone 2: fix, green

Goal: once shutdown has begun, a crew start or resume never activates a crew or starts timers.

Work: the minimal fix is in `pi/extensions/crew/index.ts`. Preferred shape: after `await drain(ctx)` in both `/crew` and `/crew-resume`, stop if `shuttingDown` is set, without changing state. Give the user a short notice such as "session is shutting down".

A guard inside `activate()` (`if (shuttingDown) return;` before the `setInterval` calls) also works. It was prototyped on 2026-10-24, see Surprises. It is the fallback if the command-level check proves awkward. Its drawback is that the resumed crew is still marked `active` in its ledger and the planner is still told "Crew resumed" during shutdown.

Result and proof: the Milestone 1 test passes, and the full crew suite passes.

### Milestone 3: the gate passes

Goal: `mutate.ts crew` exits 0.

Work: run the single mutant first, then the whole gate. If the single mutant is now killed but takes about 20 s, that's the second test's deadlock running into its `BOUND` timeout. It's acceptable, because a test that times out counts as a failure. Optionally, make that test fail fast instead: for example, assert on the dispatch result before awaiting `/crew-resume`, or bound the resume await. Do this only if it keeps the test's intent ("no worker started for a stopped crew"). Record the decision either way.

Result and proof: the gate prints `all N mutants killed` and exits 0.

## Validation

Run everything from the repo root, `/Users/tgeorge/git/dotfiles` or the worktree you're working in.

1. The new regression test fails before the fix and passes after it:
   `node --no-warnings --test --test-name-pattern="<new test name>" pi/extensions/crew/index.test.ts`
2. The crew suite passes: `node --test pi/extensions/crew/*.test.ts 2>&1 | grep -E '^ℹ (pass|fail|cancelled)'` prints `fail 0` and `cancelled 0`. It currently has 102 tests.
3. The mutant is killed, within roughly 30 s rather than 5 minutes:
   `node pi/extensions/test-support/mutate.ts crew "dispatch launches for a crew stopped during setup"`
   It prints a `killed` line and exits 0.
4. The full gate passes: `node pi/extensions/test-support/mutate.ts crew` prints `all N mutants killed` and exits 0. It takes several minutes, because each mutant reruns the suite.
5. Nothing else regressed: `node --test pi/extensions/*/*.test.ts pi/retro/*.test.ts pi/checkin/*.test.ts 2>&1 | grep -E '^ℹ (pass|fail|cancelled)'` prints `fail 0`. That was 296 pass on 2026-10-24.

## Progress

- [x] (2026-10-24) Reproduced the hang. With the mutant applied to a temporary copy, the first test fails in about 1 s. The second test times out at 20 s, and `index.test.ts` never exits; `timeout 150` killed it.
- [x] (2026-10-24) Confirmed the cause. Adding `if (shuttingDown) return;` before `setInterval` in `activate()` made the mutated suite finish in 24 s (29 pass, 1 fail, 1 cancelled), so the mutant is killed. The unmutated crew suite still passed 102/102. Prototype only; nothing is committed.
- [x] (2026-10-24) Created the worktree `~/git/worktrees/dotfiles/fix-crew-mutant-hang` on branch `fix/crew-mutant-hang`, from `master` at `8dca1a3`.
- [x] (2026-10-24) Milestone 1: added "a resume still draining when the session shuts down doesn't reactivate the crew" to `pi/extensions/crew/index.test.ts`. Red: `AssertionError: crew tools stay hidden`, and the test process hung until `timeout 60` killed it (exit 124). That reproduces the timer leak directly.
- [x] (2026-10-24) Milestone 2: added `refuseIfShuttingDown()` to `pi/extensions/crew/index.ts`. It is called right before the commit point of `/crew` (after `addWorktree`) and of `/crew-resume` (before tasks are marked interrupted). Green: the new test passes and exits 0. Crew suite: 103 pass, 0 fail.
- [x] (2026-10-24) Milestone 3: the single mutant is killed in 30 s (exit 0). Full gate: `all 62 mutants killed`, exit 0, 454 s. All extensions: 297 pass, 0 fail, 0 cancelled.
- [x] (2026-10-24) Outcomes & Retrospective filled in.

Commits: the user has not said that commits are fine for this work, so the changes are left uncommitted in the worktree.

## Surprises & Discoveries

- The crew worker that refactored this code claimed the hang was already present before its changes. On 2026-10-24, that mutant was run alone against the base commit `7a65420` and against the merged result `8dca1a3`. Both ended as `ERROR … spawnSync … ETIMEDOUT`, so the hang predates the refactor.
- The mutant is detected: the race test fails under it. The gate reports ERROR only because the test process never exits. So the problem is the leaked timer, not weak tests.
- Node's own end-of-run message, after the process was killed, was `'Promise resolution is still pending but the event loop has already resolved'` on `index.test.ts`.

## Decision Log

- 2026-10-24: the shutdown check sits at each command's commit point (just before `crew` is assigned and `activate()` runs), not right after `drain()`. `/crew` awaits UI prompts and `git worktree add` after draining, and a shutdown during any of them must be refused too. In `/crew`, a shutdown during `addWorktree` leaves the new integration worktree in place. That's acceptable, because `/crew-clean` removes it.
- 2026-10-24: chose the command-level check over the guard inside `activate()`. The guard would still mark the crew `active` in its ledger during shutdown. The new test asserts that the ledger stays `stopped`.
- 2026-10-24: did not make "a dispatch still setting up when the crew stops…" fail fast. Under the mutant it still deadlocks until its 20 s `BOUND` timeout, but a timed-out test counts as a failure, so the mutant is killed in about 30 s. Changing the test's structure would risk its intent for no real gain.

- 2026-10-24: fix the product bug (activation after shutdown) rather than add `--test-force-exit` to `mutate.ts`. Force-exit would hide timer leaks the suite is meant to catch; `index.test.ts`'s `onCancel` comment exists to prevent exactly that. It would also mask this real bug.
- 2026-10-24: rejected treating a timeout with failures already reported as "killed" in `mutate.ts`. The gate's rule that "a timeout says nothing" is deliberate, and loosening it weakens every extension's gate.
- 2026-10-24: rejected `unref()` on the sweep and render intervals as the main fix. It would let the test process exit, but a stopped session would still re-activate a crew. It might still be worth adding later, but it's out of scope here.

## Outcomes & Retrospective

- **Achieved:** `node pi/extensions/test-support/mutate.ts crew` exits 0 with all 62 mutants killed, for the first time. A real bug is fixed too: a crew start or resume that outlasted `session_shutdown` reactivated the crew and leaked `setInterval` timers. The fix is 7 lines in `index.ts`, plus one regression test.
- **Remaining:** the full gate takes about 7.5 minutes, which is slow as a crew or goal check. Running mutants in parallel inside `mutate.ts` would cut that, but it's a separate change.
- **Lesson for AGENTS.md or checks:** when a mutation gate reports ERROR or ETIMEDOUT, run the mutated suite with `timeout` and check whether the tests failed but the process didn't exit. That pattern means a leaked handle, usually a timer, and not an undetected mutant.

# Dogfood the agent tools on their own code

This ExecPlan is a living document. Keep the Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective sections up to date as the work proceeds. It follows `pi/prompts/execplan.md`. Start a session with `/execplan continue .agent/plans/dogfood-agent-tools.md`.

## Purpose

In one long session on 2026-10-21 and 2026-10-22 we researched agentic-engineering patterns and built Pi tooling from them. That code was reviewed once, by the new review loop. This plan uses the same patterns, applied to their own code, to find and fix what's still wrong, and to learn which patterns actually earn their keep.

When this is done:
- the extensions have tests for the behavior that matters;
- known open issues are fixed or explicitly accepted;
- `pi/WORKFLOW.md` reflects what worked in practice, not just what the research claimed.

You can see it working when `node --test pi/extensions/{crew,goal,advisor,mcp-confirm}/*.test.ts pi/retro/*.test.ts` passes consistently, and the review loop over the final code comes back clean or with only reproduced, low-severity findings.

## Context: what was built

Everything lives in the dotfiles repository at `~/git/dotfiles` and is pushed to `master`. The relevant commits are `9b34f2d`, `87934b7`, and `8364ab6` through `e072992`. Pi loads extensions from `~/.pi/agent/extensions/` and prompts from `~/.pi/agent/prompts/`. `link.sh` symlinks those to the `pi/` directories in this repository.

The Pi extension API types are in `/nix/store/8pm5imbp5660gq107j5aj0qdxgmnxy6s-pi-coding-agent-1.0.2/lib/node_modules/pi-monorepo/dist/core/extensions/types.d.ts`; the docs and examples are next to them under `docs/` and `examples/`. Extensions are TypeScript, loaded by Pi directly with no build step. Tests use `node:test` and run with Node 24 type stripping. The output is spec format: grep `^ℹ (pass|fail)`, not TAP's `# pass`. `sed` here is GNU sed.

The pieces, with what each is for and where it lives:

- **crew** (`pi/extensions/crew/`, about 1,700 lines with tests). A scaled-down version of Cursor's planner/worker design.
  - `/crew <goal>` turns the session into a planner. The planner has only read tools plus the `crew_*` tools.
  - Each `crew_dispatch` starts a fresh `pi -p` worker in its own git worktree under `~/git/worktrees/<repo>/`. A child extension, `guard.ts`, keeps its edits inside that worktree.
  - When a worker finishes, its handoff message wakes the planner. The handoff is the worker's claims plus facts the harness observed: commits, diff stat, files changed outside scope, and check exit codes.
  - The harness merges into the `crew/<slug>` branch. `crew_finish` refuses to finish until the final checks pass.
  - State is saved in `.git/pi-crew/<slug>.json`.
  - Key files: `index.ts` (registration and planner tools), `worker.ts` (child process), `git.ts`, `handoff.ts`, `state.ts`, `prompts.ts`, `guard-policy.ts`.
- **goal** (`pi/extensions/goal/`). `/goal <objective> --check <cmd> [--max N]`. After each agent run settles, it runs the check:
  - exit 0 completes the goal;
  - a failure continues the run with the check's output;
  - it parks when a run makes no tool calls, pauses when interrupted or on an error, and stops at the budget.

  The goal is stored in the session as a custom entry. The pure logic is in `goal.ts`; the event wiring is in `index.ts`.
- **advisor** (`pi/extensions/advisor/`). An `advisor` tool that sends the conversation, as Pi itself would project it (`ctx.sessionManager.buildSessionProjection()`), to the model set with `/advisor`. The setting is stored in `~/.pi/agent/advisor.json` and is currently `openai-codex/gpt-5.6-sol`.
- **handoff** (`pi/extensions/handoff/`). A verbatim copy of Pi's example: `/handoff <next goal>` starts a new session from an editable prompt.
- **review-loop** (`pi/prompts/review-loop.md`; "review this well" in `pi/AGENTS.md`). Three clean-context reviewers run in parallel: Opus for correctness, gpt-6.1-sol for security, Sonnet for tests and fit. Every high or medium finding needs a failing input, which becomes a failing test before any fix. The fixer stays within scope, rounds 2 and later re-check only the fixes, the cap is 3 rounds, and the report includes an overturn rate.
- **execplan** (`pi/prompts/execplan.md`). This document's format.
- **retro** (`pi/retro/collect.ts`, `pi/prompts/retro.md`, and Phase 6.5 of the weekly-review skill).
  - `node ~/.pi/agent/retro/collect.ts --days 7` mines `~/.pi/agent/sessions` and `~/.claude/projects` for friction signals.
  - `/retro` verifies those signals and writes proposals, never edits, to `~/.local/state/pi-retro/<date>.md`.
- **checkin** (`pi/prompts/checkin.md`, `pi/checkin/run.sh`, `nix/modules/features/pi-checkin.nix`).
  - A headless, read-only look across HEY, Todoist, and Fantastical that prints at most three actionable lines, otherwise `NO_REPLY`.
  - It runs with no shell or write tools. It saves state through a `STATE:` line that the script validates and writes.
  - launchd runs it on weekdays at 08:30 and 13:00, on the personal Mac only. **This needs `darwin-rebuild switch`, which hasn't been run yet.**
- **mcp-confirm allowlist** (`pi/extensions/mcp-confirm/readonly.json`, `allow.ts`). Fantastical's `get_*` and `search_events` tools are treated as read-only, because that server sets no hints.
- **Playbook:** `pi/WORKFLOW.md` says which tool fits which situation, and lists the attention rules.

How things were verified so far:
- **Unit tests:** about 90 tests across these suites, all passing.
- **End-to-end RPC runs** against toy repositories with `anthropic/claude-sonnet-5-5`:
  - crew, twice (parallel tasks, a merge conflict and its repair, a review, the enforced final check), about $0.12;
  - goal: a failing test, then a continuation, then complete;
  - advisor: one call, $0.0015.

  The driver scripts lived in `/tmp/crew-e2e` and `/tmp/goal-e2e`, and may be gone. To recreate them, spawn `pi --mode rpc --no-session --no-extensions -e <extension> -e npm:@gotgenes/pi-anthropic-auth --provider anthropic --model claude-sonnet-5-5`. Write `{"id","type":"prompt","message"}` JSON lines to its stdin. Answer `extension_ui_request` lines of type select/input/confirm with `{"type":"extension_ui_response","id",...}`. Log `tool_execution_*`, `message_end` (role `custom` for crew and goal messages), and `agent_settled`.
- **Checkin:** run live against the real accounts with `PI_CHECKIN_NOTIFY=0 pi/checkin/run.sh`.

## Known open issues (start here)

From the review loop (3 rounds, which hit the cap) and from later observation:

1. **crew guard, time-of-check vs time-of-use.** A worker can start a background process that swaps a symlink between the guard's check and the write. Only a real sandbox closes this; nono was discussed and deferred. Decide: accept it and document it in `pi/extensions/crew/README.md`, or prototype nono-wrapped workers. A nono wrapper would also need the harness to commit for workers, and checks to run under nono.
2. **crew `/crew-resume` right after `/crew-stop` in the same session.** Old worker closures keep updating the previous task objects but save the new `crew` state, so their reports are lost from the ledger (low severity).
3. **goal's event wiring is untested.** This covers `agent_settled`, `goal_park`, resume resetting the budget, and the "changed while the check ran" guard. Only the pure `decide()` is tested.
4. **crew `index.ts` is untested except end to end.** Consider extracting the planner-tool logic from Pi registration, the way `runner.ts` does in the subagent extension, so it can be unit-tested with fake workers.
5. **Retro proposals 2 and 3 are pending** in `~/.local/state/pi-retro/2026-10-22.md`: the Todoist `find-tasks` limit of 100 in the weekly-review skill's tool quirks, and the `node --test` output-format note.
6. **fut attention ordering (needs Tom's decision).** In `~/git/fut/src/client/notifications.rs`, the Notifications dialog sorts newest first within each priority, but the research says oldest first. The prefix-twice jump cycles in pane order, which is a deliberate, tested upstream behavior (`next_wraps_in_resource_order_with_current_as_the_final_candidate`). Don't change fut without asking.
7. **Flaky `pi/extensions/watch/watcher.test.ts`.** It fails about 1 in 6 runs under full-suite load. This is Tom's own uncommitted work in progress, so report it but don't touch it.
8. **The review loop itself is barely measured.** It ran once, by hand, on this code. Round 1 raised 22 findings; the overturn rate wasn't tracked carefully.

## Plan of work

The point is to use each pattern on purpose and record whether it helped. After each milestone, add a short entry to the Surprises section: what the pattern caught, what it missed, what it cost.

- **Milestone 1: baseline.**
  - Run the full test command below three times and record the flakes.
  - Run `/retro 7`, and decide on proposals 2 and 3 with Tom.
  - Done when the baseline and the retro decisions are recorded here.
- **Milestone 2: review loop, one extension at a time.**
  - Run "review this well" with the target set to each directory: `pi/extensions/goal`, `pi/extensions/advisor`, `pi/retro`, `pi/checkin` plus `pi/prompts/checkin.md`, then `pi/extensions/crew`. Do crew last; it's the largest.
  - Per directory, means a commit range or path target with `BASE` at the commit before that piece landed, so reviewers see the whole piece.
  - Track the raised, accepted, and overturned counts per run in a small table in Surprises. Expect the review loop's own prompt to need tuning; if it does, change `pi/prompts/review-loop.md` and say why in the Decision Log.
  - Done when each piece has had a loop that ended clean or at the cap, with the remaining items listed.
- **Milestone 3: close the test gaps with `/goal`.**
  - For open issues 3 and 4, write the failing tests first, then drive the fixes with a goal, for example `/goal goal extension wiring is covered --check node --test pi/extensions/goal/*.test.ts --max 8`.
  - For crew, prefer extracting testable logic over testing through Pi.
  - Done when the new tests exist, pass, and would fail if the wiring broke. Check that by temporarily breaking it.
- **Milestone 4: decisions with the advisor.**
  - For open issues 1 and 2, have the agent call `advisor` before choosing an approach. Record the advice and whether it changed the decision.
  - Implement the chosen fix, or the documentation of an accepted risk.
- **Milestone 5: dogfood crew (optional, if Milestones 2–3 produced several independent fixes).**
  - Run `/crew` on the dotfiles repository for two or three independent, checkable tasks, with `node --test` on the relevant suite as the check.
  - Note whether the overhead was worth it compared with doing them directly.
- **Milestone 6: write it down.**
  - Update `pi/WORKFLOW.md` with what actually worked: which pattern caught what, and which were noise.
  - Run `/retro` once more over these sessions.
  - Fill in Outcomes & Retrospective.

## Validation

Run from `~/git/dotfiles`:

    node --test pi/extensions/{crew,goal,advisor,mcp-confirm,subagent}/*.test.ts pi/retro/*.test.ts pi/checkin/*.test.ts 2>&1 | grep -E '^ℹ (pass|fail|cancelled)'
    node pi/extensions/test-support/mutate.ts goal && node pi/extensions/test-support/mutate.ts crew
    for e in crew goal advisor handoff mcp-confirm; do timeout 30 pi --no-extensions -e ./pi/extensions/$e/index.ts --offline --help >/dev/null 2>&1 && echo "$e loads"; done
    bash -n link.sh pi/checkin/run.sh

Expect `ℹ fail 0` and `ℹ cancelled 0` on every run (a timed-out test counts as cancelled), `all N mutants killed`, and every extension printing "loads". For behavior changes to crew, goal, or advisor, also run one end-to-end RPC session as described in Context. That costs cents.

Constraints:
- Commit only when Tom says so, as small logical commits whose message body explains why.
- Don't push.
- Don't touch `pi/extensions/watch`, `nvim/lsp`, `claude/hooks`, or `claude/skills/domain-modeling`: those are Tom's uncommitted work.

## Progress

- [x] (2026-10-22) Research, build, first review loop (3 rounds), 11 logical commits, pushed to master.
- [x] (2026-10-22) M1 baseline: full suite `ℹ pass 95 / ℹ fail 0` on 3 of 3 runs; all 5 extensions load; `bash -n` clean. No flakes (the watch suite isn't in the command).
- [x] (2026-10-22) M1 retro: `collect.ts --days 7` reran on the same day as the 2026-10-22 digest and found the same signals, nothing new. Proposals 2 (Todoist limit) and 3 (`node --test` format) are still unapplied.
- [x] (2026-10-23) M1 remaining: Tom approved retro proposals 2 and 3; applied in `2945fe6`.
- [x] (2026-10-22) M2 goal round 1: 3 reviewers, 6 findings raised, 5 accepted (see the table). Two were reproduced with an RPC e2e probe (/tmp/goal-e2e) and one with a red unit test; all fixed, uncommitted.
- [x] (2026-10-22) M2 goal rounds 2–3: round 2 accepted 1 medium (the first request still lacked the rules, reproduced via a `before_provider_request` probe) and 1 low (background jobs leaked). Round 3 accepted 1 low (a timeout during the drain overrode a real exit code). All fixed red/green. Suite at `ℹ pass 98 / ℹ fail 0`, goal loads. Stopped at the 3-round cap, with nothing above low open. Changes are uncommitted.
- [x] (2026-10-22) M2 advisor: round 1 raised 2 medium (Opus: /tree re-enables the tool against advisor.json; GPT: Pi's `serializeConversation` cuts each tool result to 2,000 characters). Both accepted and fixed; round 2 came back "No findings" from both reviewers. Uncommitted.
- [x] (2026-10-22) M2 retro: round 1 raised 5 medium and 3 low. Accepted 3 medium and 4 low, rejected 1 (secrets in the digest). Round 2 accepted 2 more (a bare rejection double-counted the interrupt; out-of-window calls lost their names). Round 3: "No findings" from both. 6 new tests, all red first. Suite `ℹ pass 105 / ℹ fail 0`. Uncommitted.
- [x] (2026-10-22) M2 checkin: round 1 raised 1 medium and 4 low. Accepted the weak STATE validation [M, GPT] and the unsubstituted `${@}` [L, Opus]. Added `pi/checkin/run.test.ts`, which runs run.sh against a fake `pi` on PATH in a temp HOME. Round 2: GPT "No findings"; Opus 1 low (multiple JSON values on the STATE line), fixed with `jq -es 'length == 1 …'`, red then green. Uncommitted.
- [x] (2026-10-22) M2 crew pre-check: confirmed the planner prompt was in NONE of the planner's provider requests. `/crew` itself starts the run through `sendMessage(triggerTurn)`. Probe: `PROBE request 1..5 hasGuideline=false`. Fixed by putting `plannerPrompt()` at the head of the `crew-start` and `crew-resume` messages and dropping the `before_agent_start` handler. After the fix, all 5 requests show `true`. e2e cost about $0.05 with haiku workers (`AUTO_UI=haiku` in `/tmp/goal-e2e/driver.mjs`). Uncommitted.
- [x] (2026-10-22) M2 crew round 1: 3 reviewers raised 0 high, 6 medium, 4 low. Fixed so far, all red then green (crew suite `ℹ pass 22`):
  - guard: `checkBash` now judges the git *subcommand* after global options (`GIT_COMMAND` regex in `pi/extensions/crew/guard-policy.ts`). Branch names like `crew/fix-git-push-…-t2` and messages like "Load remote config" no longer trip it [Opus M]. `git checkout` is blocked unless it's the `-- <paths>` form [GPT M]. `..foo` counts as inside [Sonnet L].
  - `runCheck` in `pi/extensions/crew/git.ts`: ported goal's fix (finish 500 ms after `exit`, destroy the pipes, always kill the process group). Timeout and abort return `exit: null`, so they can never read as a pass [GPT M ×2].
- [x] (2026-10-23) M2 crew round 1, the 4 queued fixes, red then green where a unit seam exists (crew suite `ℹ pass 26`, full suite `ℹ pass 116`):
  1. Dirty worktrees after checks: new `dirtyFiles` (`status --porcelain -z`, so names with spaces aren't quoted) and `discardChanges` in `git.ts`. `crew_integrate` and `crew_finish` revert the integration worktree after their checks; `crew_finish` refuses when anything was dirty. `buildReport` records `dirtyAfterChecks`, and `formatReport` lists it as a harness fact.
  2. Cancellable planner checks: a crew-level `crewAbort` controller, renewed in `activate()`, aborted in `deactivate()` (so by `/crew-stop` and finish) and on shutdown, combined with the tool's own signal via `AbortSignal.any`. `crew_finish` refuses if its captured signal aborted or `crew !== state || !isActive()` after the checks.
  3. Interrupted tasks: `crew_integrate` now asks the branch (`branchCommits(repoRoot, base, branch)`), not `task.report`.
  4. `outsidePaths`: a glob segment widens to its directory; a top-level glob (`*.md`) restricts nothing.
  - index.ts wiring has no unit seam (open issue 4, Milestone 3). Verified items 1 and 4 with an e2e instead (`/tmp/goal-e2e/crew-dirty.json`, haiku worker, ~$0.08): `crew_finish` with `date > stamp.txt` refused, listing `stamp.txt`; the integration worktree was clean afterwards; `paths ["*.txt"]` didn't flag `hello.txt`. Items 2 and 3 are unverified beyond loading and reasoning.
- [x] (2026-10-23) M2 crew round 2 (Opus, GPT on `git diff -- pi/extensions/crew`): fixes 2–7 held up. Accepted 1 high and 2 medium, all regressions or gaps in *my round-1 guard fix*: global options with separate or quoted values (`git --work-tree . push`, `git -C "my dir" push`) [GPT H, Opus M]; bare `git checkout main --` switches branch [both M]; `git clean -fd` skips a nested repo a check created [GPT M]. Opus lows also accepted: `$(git push)` nested in args, inline `-c alias.p=push p`. Fixed red then green (regex extended; `clean -ffd` plus a post-clean verify that throws).
- [x] (2026-10-23) M2 crew round 3 (the cap; Opus, GPT on the round-2 changes): 9 findings, **all reproduced** with `/tmp/chk.ts`: an exponential ReDoS in my extended regex (`"git" + " --git-dir=x".repeat(24)` took 492 ms, doubling per 2 more), `$(...)`/backtick values after `-C` hiding the call, flags after a substitution unread, attached `-C.`/`-calias…`, quoted `"$(git push)"` swallowed, redirections counted as paths, and two false positives (`checkout -- $(…)`, `-m 'Document --amend'`). Asked the advisor (see the Decision Log), then replaced the regex with a bounded shell-word lexer in `guard-policy.ts`. Red tests first: all 9 reproducers plus extras, and a subprocess test with a 5 s timeout for pathological input. Crew suite `ℹ pass 29`, full suite `ℹ pass 119 / ℹ fail 0`, all extensions load. README updated (guard scope; `crew_finish` dirty refusal). **The lexer itself hasn't been independently reviewed.** The loop stopped at the cap, so this result isn't "clean".
- [x] (2026-10-23) Committed and pushed; see Tom's decisions below.
- [x] (2026-10-23) M3 goal (open issue 3): `pi/extensions/test-support/fake-pi.ts` is a fake `ExtensionAPI`. It stubs `typebox` and `pi-ai` with `module.registerHooks`, so tests must `await import("./index.ts")` after importing it. No `index.ts` lives there, so Pi won't load it. `pi/extensions/goal/index.test.ts` has 7 wiring tests. A mutation gate, `node pi/extensions/test-support/mutate.ts <ext>`, applies `<ext>/mutants.json` to a temp copy and fails while any mutant survives: goal `all 10 mutants killed`. The first manual pass left 2 survivors (the changed-during-check guard, which `decide()` already covers for clear but not for replace; and entry snapshots); both tests were tightened.
- [x] (2026-10-23) M3 crew (open issue 4). The seam is an optional 2nd factory arg `{ runWorker }`; Pi calls `factory(api)` (`loader.js:514`). `crew/mutants.json` has 29 wiring mutants. `/goal` ran headless with Sonnet (`/tmp/goal-e2e/driver2.mjs`, log `/tmp/goal-e2e/m3.log`) against the check `node pi/extensions/test-support/mutate.ts crew`, and completed **in its first run (0 continuations), 13 min**. It wrote `crew/index.test.ts`: 20 tests, 344 lines. They use real temp git repos under a temp `$HOME` and a controllable fake worker, and assert what the planner sees. Checksums of `mutants.json`, `index.ts`, and `mutate.ts` were unchanged (no gaming), and `fake-pi.ts` was untouched. Re-verified myself: `all 29 mutants killed` (2 min). Full suite `ℹ pass 146 / ℹ fail 0` on 3 of 3 runs. No leaked worktrees.
- [x] (2026-10-23) M4. The advisor was consulted on both issues; see the Decision Log.
  - Issue 1 (TOCTOU): accepted and documented in `crew/README.md` Limits. An OS sandbox is future work.
  - Issue 2 (stale closures): fixed red then green.
    - `/crew` and `/crew-resume` run under `switchCrew` (refuses a concurrent start or resume), then `drain()` waits for worker closures (`pending`) and tracked `crew_integrate`/`crew_finish`/`crew_dispatch` executions (`planning`).
    - `controllers.delete` is identity-checked.
    - 3 red tests: resume waits and the report survives on disk; resume waits for an in-flight finish; two resumes activate once.
  - A 1-round review of the change (Opus and GPT) found **the same medium independently**: `crew_dispatch` wasn't tracked, so a dispatch paused in `addWorktree` during stop and resume launched an unaborted worker against stale state. Fixed red then green: a slow `post-checkout` hook makes the pause deterministic. Dispatch is now tracked and re-checks `crew === state && isActive()` before `launch()`, refusing with the task marked cancelled.
  - This replaced a Sonnet-written test ("a worker dispatched as the crew stops never wakes a stopped crew") that pinned the old race. The `tell wakes an inactive crew` mutant became equivalent: every path to `tell(…, true)` while inactive is now closed upstream. It was removed from `mutants.json`; the guard stays as defense in depth.
  - Crew tests got a 20 s per-test timeout. A broken drain hangs rather than fails, and node:test reports a timed-out test as `ℹ cancelled`, not `fail`. `mutate.ts` now counts `cancelled` as a kill (the gate's own whole-run timeout is still an error).
  - Result: `all 32 mutants killed`; goal `all 10`.
- [x] (2026-10-23) Environment flake found: global `commit.gpgsign=true`, and once the gpg-agent cache expired, test-setup commits blocked on pinentry for 120 s and then failed. Fixed in `crew/git.test.ts`'s helper (`-c commit.gpgsign=false`); `index.test.ts` was already immune because it sets a temp `$HOME`. **The same bug is in `pi/extensions/subagent/git-policy.test.ts:53` and `subagent/panel.test.ts:259` (not mine; for Tom).** Validation without subagent: `ℹ pass 87 / fail 0 / cancelled 0`. All 5 extensions load; `bash -n` is clean. With subagent included, it's `148 / 2` until that's fixed or the gpg cache is warm.
- [x] (2026-10-23) Milestone 5 (optional): skipped; see the Decision Log. Crew was exercised by e2e probes, and its test suite was produced by `/goal` instead.
- [x] (2026-10-23) M6:
  - `pi/WORKFLOW.md` gained a row for the mutation-gate `/goal`, a review note (bugs live in the fixes), a "What dogfooding taught" section, and the test-support location.
  - Retro: `collect.ts --days 2` and the digest in `~/.local/state/pi-retro/2026-10-23.md`. 2 proposals: (1) test commits must disable signing, plus fixing the subagent helpers; (2) the mutation gate, already recorded. Proposals 2 and 3 from 10-22 are still pending.
  - Outcomes filled in.
- [x] (2026-10-23) Tom's decisions:
  - He approved all three retro proposals; they're applied in `2945fe6`.
  - He approved committing: 13 logical commits, `04d308a..2945fe6`, pushed to master. That's the 12 proposed plus one for the retro proposals. Each commit was verified green in a detached worktree (`ℹ fail 0`), and the final one also without the signing override.
  - fut notification ordering (open issue 6) is tabled for now.

## Surprises & Discoveries

- 2026-10-23 (M3): `/goal` with a mutation gate as its check is the best-performing pattern so far. One unattended run produced a test suite I'd have written myself, because the check said exactly *what* had to be detected. Running the suite alone wouldn't have. The gate's own bug (timeouts and load errors counted as kills) was caught by the advisor, not by the run. Cost isn't visible in the driver log (subscription auth).
- 2026-10-23 (crew rounds 2–3): The review loop's worst finds were in my *own fixes*. Round 1's guard fix introduced bypasses that the old code blocked. Round 2's fix introduced a ReDoS. Each round's narrower diff got sharper scrutiny, and every round-3 claim reproduced (0 overturned). Pattern: when a fix is a regex over a language (shell), reviewers will keep finding spellings. Switch to a parser after the second miss, not the third.
- 2026-10-23: The e2e for crew fix 1 cost ~$0.08 and is the only check of the index.ts wiring for dirty-finish. Prompting the planner with an exact "test protocol" (checks and paths verbatim, "don't retry") made it a deterministic probe.
- 2026-10-22: `pi/extensions/subagent/{index,panel,panel.test}.ts` gained uncommitted changes during this session from someone else, a ctrl+o task-prompt expansion. Its new test `popup expands the task prompt with ctrl+o` fails (red-first work in progress), so the full suite showed `ℹ fail 1` for a while. By the end of the session it passed (`ℹ pass 112 / ℹ fail 0`). Not mine; don't touch it.

From the build session:
- Reviewers found real escapes that unit tests missed: `file://` paths and dangling symlink chains in the crew guard. In round 2, two reviewers on different models independently found the same bug in the first fix. Running models from different vendors in parallel paid off.
- A planner told to "run a final green pass" skipped it. Enforcing it in the harness (`crew_finish` runs the checks) fixed that. Prompt compliance alone isn't enough for gates.
- `/goal` parked correctly when the check command was malformed, instead of looping.
- Session mining found a real, repeated habit: `sed -i ''` under GNU sed. Explicit corrections from Tom were rare, so friction signals carry more information than corrections.

### Review-loop tally

| Target | Round | Raised (H/M/L) | Accepted | Overturned / rejected | Notes |
|---|---|---|---|---|---|
| goal | 1 | 1/3/2 (6; runCheck hang raised twice) | 5 distinct (abort, prompt section, runCheck hang, entry aliasing, /tree) | 0 | Sonnet: "No findings". GPT found both Pi-runtime bugs by reading `agent-session.js`. |
| goal | 2 | 0/2/3 | 2 (first request lacked the rules [M], background jobs leaked [L]) | 2 rejected (abort during backoff/compaction, M from GPT and L from Opus: with a passing check the goal really is met, and with a failing one `errored` pauses it). 1 deferred to M3 (wiring tests). | GPT's "first request" claim contradicted my turn_start probe, and was right: `getSystemPrompt()` is not what gets sent. |
| advisor | 1 | 0/2/0 | 2 (tool state after /tree; tool results truncated) | 0 | Sonnet: "No findings". The truncation was confirmed red/green by an e2e with a random hex token: old code `UNKNOWN`, new code returns the code. |
| advisor | 2 | 0/0/0 | – | – | Clean. |
| retro | 1 | 0/5/3 | 7 (Claude rejection feedback lost [M], non-array content crash [M], mtime-only window [M], sidechain prompt counted as user [L], dangling symlink crash [L], rejected calls counted as errors [L], quadratic clustering [M→L]) | 1 rejected (secrets copied into the local digest: same data, same disk, no new boundary) | Opus used real transcript lines as evidence. Sonnet: "No findings". |
| retro | 2 | 0/2/1 | 2 (bare rejection + Claude's interrupt marker = double count [M], pre-window calls unnamed [M, also raised as L by Opus]) | 0 | Opus caught that my test fixture left out the marker line that real transcripts always have. |
| retro | 3 | 0/0/0 | – | – | Clean. |
| checkin | 1 | 0/1/4 | 2 (STATE validation [M], `${@}` unsubstituted [L]) | 3 rejected: no tests (answered by adding run.test.ts anyway), hard-coded checkout path (the repo-wide convention via link.sh), undeclared coreutils/jq (Opus traced them to hm.default) | Opus's long trace of the timeout, pipefail, and permission paths found them sound. |
| checkin | 2 | 0/0/1 | 1 (multiple JSON values on the STATE line) | 0 | GPT: "No findings". |
| crew | 1 | 0/6/4 | 9 (guard false positives [M], checkout bypass [M], timed-out check passes [M], background jobs leak [M], dirty worktrees after checks [M], finish checks not cancellable [M], interrupted tasks can't integrate [L], glob scopes [L], `..foo` [L]); 5 fixed, 4 queued | 1 rejected (test name) | Pre-review e2e probe found the planner prompt missing from every request, which no reviewer would have caught: they were told it was already fixed. |
| crew | 2 | 1/3/2 (guard option values raised by both) | 5 (option values with spaces/quotes [H], bare `checkout main --` [M], nested repo survives clean [M], `$(git push)` in args [L], inline alias [L]) | 0 | All in my own round-1 guard fix. Fixes 2–7 (runCheck, dirty worktrees, abort, interrupted, globs, planner prompt) held up. |
| crew | 3 | 0/7/2 (GPT 4 M; Opus 2 M + 1 L, counted per distinct item) | 9, all reproduced (ReDoS, 4 bypasses, redirection, 2 false positives, attached values) | 0 | At the cap. Regex patching was whack-a-mole; replaced it with a lexer, not re-reviewed. |
| crew M4 (issue 2 fix) | 1 | 0/2/0 (same finding from both) | 1 (untracked `crew_dispatch` escapes the drain) | 0 | Not required by the plan; ~1 min. Opus also answered every question in the prompt (no deadlock, `switching` can't stick, no unhandled rejections). |
| goal | 3 | 0/0/1 | 1 (a timeout during the drain overrode the exit code) | 0 | Only 2 reviewers, on a 2-change diff, ~$0.10. |

- advisor e2e lesson: my first truncation probe put the marker in the command, so the old code "passed" because the model inferred it from the tool-call args. Probes need an unguessable payload (`openssl rand -hex 4`).
- Lesson from goal round 2: a probe has to observe what is actually sent (`before_provider_request` payload), not a getter that approximates it. My first probe gave a false green.

- goal round 1 (2026-10-22): GPT-6.1 found two real wiring bugs that 90 unit tests and the earlier e2e run missed. Interrupts didn't pause the goal, and the goal system prompt never reached goal-driven runs. Both reproduced in a ~$0.05 RPC e2e. Evidence before the fix: `PROBE turn_start goalSection=false` on every turn, and after an abort, `custom goal: Goal not met yet (continuation 1/3)`. The same `before_agent_start` + `triggerTurn` pattern is in `pi/extensions/crew/index.ts:63,513`, so crew's planner prompt likely misses its wake runs too. Check that in crew's review.
- A user abort during a tool shows up as `stopReason=error`, not `aborted`; `ctx.signal.aborted` is the reliable signal.

## Decision Log

- 2026-10-23: M4 issue 2's fix got a one-round, two-reviewer check, though the plan didn't require one: it was a concurrency change. Both reviewers found the same missed case (untracked dispatch) in under a minute. Small focused diff plus two vendors is still the best value per dollar in this plan.
- 2026-10-23: The gpg-signing hang looked like a code regression ("git.test.ts hangs every time") until a 10 s `git commit` probe in /tmp showed the environment. When a previously green suite goes red with no relevant diff, probe the tool, not the code.
- 2026-10-23: M5 (crew dogfood) skipped. No independent, checkable fixes were left. The remaining items are Tom's decisions or his files (`subagent/*`). The crew harness was exercised by two e2e probes this session. Crew's test suite came from `/goal` instead, which answered the M5 question for a single task better than a contrived crew run would.
- 2026-10-23 (M4, advisor): Issue 1, accept and document; no nono now. Filesystem confinement alone wouldn't cover the network or the shared git common dir. That matched my leaning. Issue 2, drain pending work before `/crew` or `/crew-resume` replaces `crew`. The advisor *added* two things I'd missed: also drain in-flight `crew_integrate`/`crew_finish`, whose `discardChanges` runs even after an abort, and serialize the transitions. It also flagged that `mutate.ts` counted timeouts and load errors as kills; fixed (a completed run with `ℹ fail N>0` is the only kill) and verified on a 4-mutant demo. Rejected for the second time: its claim that my plan read was truncated (every `##` section was in it).
- 2026-10-23: M3's `/goal` check is a mutation gate, not "tests pass". "Tests pass" is satisfied by an empty test file, so a goal driven by it ends at once. Killing named mutants is objective and says which behavior the tests must pin. The goal tests were written by hand: there was no fix for /goal to drive, and the 2 surviving mutants showed the gate earns its keep. Crew's are delegated to `/goal` as the dogfood.
- 2026-10-23: The crew bash guard is now a bounded shell-word lexer (quotes, `$(...)`/backticks judged as separate commands, redirections and heredocs dropped, git global options parsed, exact argument words), failing closed only when a line it can't parse mentions git. Why: three review rounds kept finding spellings that slipped past the regexes, and round 2's regex backtracked exponentially. Rejected: reverting to the line-wide regex (it brings back the false positives on branch names and messages); a hybrid (keeps both problems). The advisor (gpt-6.1-sol) recommended this, suggested the subprocess timeout test, and said not to run a 4th round (the cap limits review rounds, not fixes), but to record that the final code isn't independently reviewed. Followed, except that its claim that my plan read was truncated was wrong: the read was complete. The advice didn't change my leaning toward the lexer. It did add the subprocess hang test and settle the round-4 question.
- 2026-10-23: After checks, the harness reverts the *integration* worktree (it's harness-owned, and leftovers turn later merges into false conflicts) but only *reports* a dirty task worktree (the worker's evidence; the branch is what merges). `crew_integrate` keeps a merge whose post-merge checks dirtied files and says so; only `crew_finish` refuses. `crew_integrate` reads commits from the branch always, not only when the report is missing: the branch can't disagree with itself, and it also works after `/crew-clean` removed the worktree.

- 2026-10-22: crew's planner prompt moved into the start and resume messages, not into tool `promptGuidelines` as goal's did. It's long and dynamic (goal, branch, concurrency, budget), and every planner run already starts with one of those two messages. Risk accepted: compaction may summarize it away in a very long crew. If that shows up, move the static "Your job" rules into `crew_dispatch`'s guidelines.

- 2026-10-22: goal's rules moved from a `before_agent_start` system-prompt section to `goal_park`'s `promptGuidelines`. Pi includes tool guidelines whenever the tool is active, and goal_park is active exactly while a goal is. The objective, check, and budget ride in the goal's own wake messages. Why: Pi never emits `before_agent_start` for `sendMessage({triggerTurn})` (`agent-session.js` `sendCustomMessage` calls `_runAgentPrompt` directly), so the section was missing from every goal-driven run. Rejected: `sendUserMessage` (the wake would render as if the user wrote it), and a `context_with_system` rewrite (too invasive).
- 2026-10-22: goal detects aborts from `message_end` (the assistant's `stopReason`, or `ctx.signal.aborted`) instead of `agent_before_settle`, because Pi skips that boundary once `abort()` sets `_agentRunAbortRequested`.

- 2026-10-22: Fixes from the review loop must reproduce as failing tests first. Why: the research on reviewers overcorrecting.
- 2026-10-22: The retro only proposes changes. Why: a self-editing harness drifts with no audit trail.
- 2026-10-22: Reverted the herdr attention sort, because Tom uses fut now. The fut change is pending his decision (open issue 6).

## Outcomes & Retrospective

**Result (2026-10-23).** All 8 open issues are resolved or handed off:
- 1, TOCTOU: documented.
- 2, stale closures: fixed.
- 3, goal wiring tests: done, 10/10 mutants killed.
- 4, crew `index.ts` tests: done, 32/32 mutants killed.
- 5, retro proposals: waiting on Tom.
- 6, fut: waiting on Tom.
- 7, watch flake: Tom's.
- 8, review-loop measurement: the tally table, 14 rows.

The suite went from 95 tests to 150. There are 24 new crew wiring tests and 7 goal wiring tests, plus a mutation gate that proves they detect the breakage they're named for. Everything is uncommitted, pending Tom.

**What the patterns earned:**
- **Review loop, multi-vendor:** the biggest yield. Of 58 raised findings, 46 were accepted and 7 rejected; the other 5 were duplicates or deferred to M3. The best finds were Pi runtime facts (`before_agent_start`, abort skipping settle, tool-output truncation) and holes in the previous round's fixes. In crew's round 3 every claim reproduced. Weakness: it can't converge on a fix built on the wrong abstraction (a regex for shell); I had to change approach.
- **E2E probes:** found the bug no reviewer could see, the planner prompt missing from every request. But twice they gave a false green until they observed the wire payload with an unguessable token.
- **Red/green TDD:** cheap and reliable for pure code. For wiring it needed a seam (fake-pi), and "would it fail if broken?" needed the mutation gate. Hand-written tests left 2 of 10 goal mutants alive.
- **`/goal`:** strong when the check is precise. A mutation gate turned "write good tests" into a checkable finish line, and Sonnet met it in one run.
- **Advisor:** useful twice: it added the in-flight-tool drain and caught the gate's timeout and load-error bug. It was wrong twice about the transcript (a truncation that didn't happen). Net positive at decision points; verify its factual claims.
- **ExecPlan and handoff:** the plan resumed cleanly across sessions with no lost state, and the tally table made overturn rates visible.

**What I'd do differently:** run the e2e wire probe *before* the first review round on any extension that injects prompts. Switch from patching to a parser after the second failed fix to the same parser-like code. Disable commit signing in every test helper from day one.

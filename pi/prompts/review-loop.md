---
description: Review a change with clean-context reviewers, fix accepted findings, and loop until they call it good; or, for a PR with no local checkout, review once and post the findings to the PR
argument-hint: "[here | PR | branch | worktree path | crew [slug] | A..B] [extra focus]"
---
Run a review-fix loop on target "${1:-here}". ${@:2}

I'm asking you to delegate reviews to `reviewer` agents (`agent_spawn`) for this whole task. Use the models named below; don't ask me to pick.

## 0. Set up
Work out three things: `DIR`, the checkout where the change lives; `BASE`, the commit the change is measured against; and the change's intent.

`DEFAULT` is the repo's default branch: `git symbolic-ref --short refs/remotes/origin/HEAD`, falling back to `main`. Pick the first rule that matches the target:

- **`here` or nothing:** the work in the current checkout, such as what an agent or a team of agents just produced, committed or not.
  - `DIR` is the repo root.
  - On the default branch, `BASE=HEAD`, so only uncommitted work is reviewed.
  - On any other branch, `BASE=$(git merge-base $DEFAULT HEAD)`.
  - If there's nothing to review, say so and stop.
- **`crew` or `crew <slug>`:** a crew's integration branch.
  - Read the newest ledger in `$(git rev-parse --git-common-dir)/pi-crew/`, or `<slug>.md`.
  - `DIR` is its integration worktree, and `BASE` is its base commit.
  - The intent is its goal plus its summary.
  - If the crew's status is still `active`, ask me first, because its workers may still be merging.
  - Older crews left `<slug>.json` ledgers instead: use `config.integrationPath`, `config.baseSha`, `config.goal`, `summary`, and `status`.
- **A PR number or URL:**
  - Run `gh pr view <pr> --json number,title,body,url,baseRefName,baseRefOid,headRefName,headRefOid`. A bare number only resolves inside a clone of the PR's repo; outside one, ask me for the URL.
  - If the current directory is a clone of the PR's repo and `git worktree list` shows `headRefName` checked out, `DIR` is that worktree and `BASE=$(git merge-base origin/<baseRefName> HEAD)`, run in `DIR`. Continue with the loop below.
  - Otherwise, don't check anything out. Switch to **Review-only mode** at the end of this file and follow it instead of steps 0–5.
- **An existing directory:** a worktree, such as a crew task's or a teammate's.
  - `DIR` is that path.
  - `BASE` is set as for `here`, but run inside `DIR`.
- **`A..B`:** a commit range.
  - `B` must be checked out somewhere, or be the current `HEAD`; otherwise ask me.
  - `DIR` is that checkout, and `BASE=A`.
- **Any other branch name:**
  - If `git worktree list` shows it checked out, `DIR` is that worktree. Otherwise ask before checking it out, and stop if the current checkout has uncommitted changes.
  - `BASE=$(git merge-base $DEFAULT <branch>)`.

Then:
- Run every git command and check with `git -C "$DIR"` or `cd "$DIR" &&`. Make every edit with paths under `DIR`. Your own working directory may be a different checkout, so never edit there by mistake.
- Find the project's checks: tests, lint, typecheck and formatter. Look in AGENTS.md, the README, the Makefile, package.json and similar files. Run them once in `DIR`. If they already fail before any fixes, tell me before you continue.
- **Go:** if the project doesn't already cover them, also run `gofmt -l`, `go vet` and `go test -race` on the changed packages, and `golangci-lint run --new-from-rev=$BASE` if the repo configures it. Lint hits in changed code are mechanical idiom findings; triage them yourself, don't send them to reviewers.
- Write a 2–4 sentence statement of the change's intent. Take it from the PR title and body, the crew goal, or what I asked for earlier in this conversation, plus my message here. That intent is the yardstick for every decision below. If you can't tell what the change is meant to do, ask me.

## 1. Review: all four in parallel, each with a clean context
Reviewers can't run git, so write the change to a file outside `DIR`. Once per review, run `R=$(mktemp -d)`. Round 1's diff is `git -C "$DIR" diff $BASE > $R/round-1.diff`; later rounds' diffs come from step 3's snapshot (see step 4). Keep the files until the review is done.

Make four `agent_spawn` calls in a single turn:
- agent: `reviewer`
- model: from the table below
- cwd: `DIR`
- name: `review-<letter>-r<round>`, such as `review-a-r1`. Names must be unique in this session, so add a suffix if one is taken.

Give each reviewer:
- the intent statement;
- `BASE`, and the path of the diff file;
- the list of changed files from `git diff --stat $BASE` and `git status --porcelain`, both run in `DIR`. Name untracked new files explicitly, because the diff doesn't show them.

Each review arrives as its own message when that reviewer finishes. Wait until all four have arrived before you triage. Don't poll with `agent_list`; end your turn while you wait. If a reviewer asks a question, answer it with `agent_send`.

Don't give them your reasoning or earlier rounds' discussion. They should judge the code fresh.

| Reviewer | Model | Focus |
|---|---|---|
| A | `anthropic/claude-opus-5-5` | Correctness: logic errors, missed edge cases, broken invariants, concurrency, error handling. |
| B | `openai-codex/gpt-6.1-sol` | Security and robustness: injection, authz, secrets, unsafe input, resource leaks, failure modes. |
| C | `anthropic/claude-sonnet-5-5` | Tests: missing or weak tests, behavior changes without tests, and tests a reader can't follow (unnamed magic expected values, one long script instead of named cases, assertion boilerplate hiding intent). |
| D | `anthropic/claude-opus-5-5` | Simplicity and idiom: concerns complected together (Rich Hickey, "Simple Made Easy"), unidiomatic Go or TypeScript, departures from the codebase's conventions, hand-rolled code the repo's existing dependencies or the standard library already provide, dead code. |

Reviewers asked to "find problems" invent them: in studies, models rejected 25–75% of correct code, and asking them to explain and fix made it worse. So don't presume a problem exists. Tell every reviewer:
- Read the diff file to see the change, including uncommitted work, and read the new files directly.
- Read the surrounding code before judging it.
- **The bar (A, B, C):** report a finding only if it breaks correctness, security, or a stated requirement. Style, alternative designs, and "more tests would be nice" are not findings. (Unreadable tests are C's exception: they are a finding when a failure wouldn't tell the reader what broke.)
- **"If the change is correct and meets the stated requirements, say so and report no findings."** Write `No findings.` in that case. That is a good outcome, not a failed review.
- **Evidence:** every high or medium finding must include a concrete failing input, counterexample, or a test that would fail. A finding without one can be at most low.
- Report one finding per line, as `[high|medium|low] path:line: problem. Evidence: ...`. Don't propose fixes; the fix comes later, after the evidence holds up.
- In rounds 2 and later, also send the "already decided" list (see below), with the instruction: "Don't re-raise these unless the code changed in a way that makes them newly relevant."

Reviewer D has its own bar, because design costs don't show up as failing tests. Tell D:
- Read `~/.agents/skills/simple-code/RUBRIC.md` first and use it as a lens, not a checklist. Methods, pointers, mutable state and positional arguments are not findings by themselves; unnecessary coupling is.
- Report only problems the change introduces or materially worsens. Evidence may come from surrounding code.
- The codebase's own conventions (AGENTS.md, neighbouring packages) win over the rubric.
- Format: `[high|medium|low][simplicity|idiom] path:line: problem. Concerns: <the two or more things braided together, or the idiom broken>. Cost: <a concrete change that must now touch both concerns, a test that can't be written without the other concern (e.g. arithmetic only testable through a database), a bug class the coupling invites, or the existing helper/dependency it duplicates>. Smallest change: <one line>.`
- For `[idiom]`, cite the source: Effective Go, Go Code Review Comments, `go vet`/staticcheck, or a named file in this repo showing the convention.
- A finding with no concrete Cost is at most low. Taste ("I'd name it differently", "could be shorter") is not a finding.
- "If the code is already simple and idiomatic, say so and report no findings."

## 2. Triage against the intent
Merge duplicates. Decide on each finding:
- **Accept** if it's a real problem in this PR's scope.
- **Reject** if it's wrong, out of scope, contradicts my request or the intent, or is pure taste. Give a one-line reason.
- **Defer** if it's real but belongs in a separate change.

You make the call, not the reviewers. Don't accept a finding just because a reviewer was confident.

**Execution decides, not confidence.** For each high or medium finding, turn its evidence into a failing test (red), and run it in `DIR`:
- If it fails, the finding is real. Accept it, and keep the test.
- If it passes, or you can't reproduce it, downgrade the finding to low and reject it as unreproduced. Note that in the report.
- If a finding truly can't be expressed as a test, such as a race or a security property, reason it through against the code. Accept it only if you can explain the exact failing scenario.

**Simplicity and idiom findings** (D) are judged by their Cost, not by a red test:
- **Accept** if you can confirm the braid or broken idiom by reading the code, the Cost holds, and the smallest change is local to this change's scope and preserves behavior.
- **Defer** as a design note if the fix is a redesign (an RPC split, a new package, swapping a hand-rolled mechanism for a library with different semantics). A suggested replacement is a candidate until you've checked its semantics match; say what differs.
- **Reject** if it's taste, contradicts the codebase's conventions, or the Cost doesn't hold up.

Add every rejected and deferred finding to the "already decided" list.

## 3. Fix and verify
- Before the first fix of each round, snapshot `DIR` so the next round can review only the fixes: `SNAP=$(git -C "$DIR" stash create)`, or `git -C "$DIR" rev-parse HEAD` if that prints nothing. It doesn't touch the worktree. Also save the list of untracked files from `git -C "$DIR" status --porcelain`.
- Fix each accepted finding until its failing test passes (green). Change only what the finding names, minimally, in the existing style. Don't add abstractions, defensive checks, or options that no finding asked for.
- Simplicity fixes are behavior-preserving refactors. Green checks are not proof on their own: walk the "Watch for behavior drift" list in `~/.agents/skills/simple-code/SKILL.md` (step 4), and check transaction boundaries, locking, cancellation, error contracts, ordering, and nil vs. empty. When you pull a pure core out of I/O, add table tests for the core.
- You may skip a fix that seems unsafe or would need a wider change. List it as unresolved instead of forcing it.
- Run all the checks in `DIR`. Fix any failures your changes caused.
- Don't commit, push, or change git history. Leave the changes uncommitted in `DIR` for me. For a crew target, this means the integration branch's worktree.

## 4. Loop or stop
- **Stop** when a round produces no accepted high or medium findings and the checks pass. That's "the reviewers call it good."
- **Otherwise** start another round from step 1, with fresh reviewer agents and the "already decided" list. Rounds 2 and later review **only this round's fix diff** (`git -C "$DIR" diff $SNAP > $R/round-N.diff`, plus any untracked files the fixes created or changed, named explicitly) against the accepted findings, not the whole change again. A full re-review just generates new findings forever.
- In those rounds, D checks that each accepted simplicity fix actually removed the coupling it named, and A checks the fix diff for behavior drift. Accepted simplicity findings still open after the last round are listed as unresolved; don't call that result clean.
- **Hard limit:** 3 rounds. If high or medium findings remain after round 3, stop.
- If the same issue survives two fix attempts, stop and escalate it to me instead of looping.

## 5. Report
Keep it short.
- **Target:** `DIR` and `BASE`.
- **Verdict:** clean after N rounds, or stopped at the limit with issues left.
- **Fixed:** each finding, its reviewer, and what changed (path:line).
- **Simplified:** each accepted simplicity or idiom finding, the concerns it separated, and what changed (path:line).
- **Rejected and deferred:** each finding with its one-line reason (including "unreproduced"), so I can overrule you.
- **Design notes:** deferred simplicity findings that need a redesign, each with its Cost and what a replacement would change semantically.
- **Overturn rate:** findings raised vs accepted. If most were rejected, say so; the reviewers are overcorrecting on this code.
- **Unresolved:** anything still open, with your recommendation.
- **Checks:** the commands run and their final status.

## Review-only mode: a PR with no local checkout
One round of review, no fixes, then a review posted to the PR from my GitHub account (`gh` is authenticated as me): request changes if blocking findings survive, otherwise approve, with any non-blocking simplicity notes included. Steps 1 and 2 apply with the changes below; steps 3 and 4 don't.

### Set up
- `OWNER/REPO` and `N` come from the PR URL. `HEAD` is `headRefOid`.
- `BASE=$(gh api repos/OWNER/REPO/compare/<baseRefOid>...<headRefOid> --jq .merge_base_commit.sha)`. That is the merge base GitHub diffs against.
- Make a throwaway shallow checkout so the reviewers can read surrounding code. `pull/N/head` also covers PRs from forks:
  ```sh
  DIR=$(mktemp -d)/repo
  gh repo clone OWNER/REPO "$DIR" -- --depth=1 --filter=blob:none --no-checkout
  git -C "$DIR" fetch --depth=1 --filter=blob:none origin "pull/N/head" "$BASE"
  git -C "$DIR" checkout -q --detach "$HEAD"
  ```
  Check that `git -C "$DIR" diff --stat $BASE $HEAD` matches the PR's changed files. If the clone fails, tell me and stop.
- Fetch what's already been said, so the review doesn't repeat it: `gh api --paginate repos/OWNER/REPO/pulls/N/comments` and `gh api --paginate repos/OWNER/REPO/pulls/N/reviews`.
- Don't install dependencies or run the project's checks.
- Write the intent statement from the PR title and body plus my message.

### Review
Run step 1 as written, with `DIR` the throwaway checkout. Write the diff file with `git -C "$DIR" diff $BASE $HEAD`; there is no uncommitted work.

### Triage
Run step 2, but you can't execute tests, so reason instead. Accept a high or medium finding only if you can name the exact input or scenario that fails and trace it through the code in `DIR`. Otherwise reject it as unverified. Also reject anything already raised in the PR's existing comments or reviews. Triage D's findings as in step 2; accepted ones are **non-blocking** unless my message asks for simplicity to block.

### Post
Pick the verdict:
- **Any accepted blocking finding:** `REQUEST_CHANGES`, with the findings as below. Non-blocking simplicity findings go in too, labelled **Non-blocking**.
- **Only non-blocking findings:** `APPROVE`, with my rocket-frog image at the top of the body and the non-blocking findings posted as below. Don't drop them.
- **No accepted findings:** `APPROVE`, with my rocket-frog image as the body: `![rocket-frog](https://github.com/user-attachments/assets/eacbe96a-fe74-4b61-9fc8-a56a46f898fc)`. No inline comments.
- **I'm the PR's author** (`gh api user --jq .login`): GitHub rejects both, so post findings as `COMMENT`, and if there are none, post nothing and tell me it looks clean.

Then ask me whether I want to see a draft first:
- **Yes:** show me the draft: the verdict, the body, and each inline comment with its `path:line`. Apply any edits I ask for, including a different verdict, then post it once I approve. If I decline, don't post.
- **No:** post it straight away.

Post one review:
- Each accepted finding whose line falls inside a hunk of `git diff $BASE $HEAD` for its file (new-side line numbers) becomes an inline comment. Any other finding goes in the review body as `path:line`.
- Write as me, to a colleague: plain, specific, short. Open with the severity in bold, state the problem and the failing scenario, and suggest a fix only when it's obvious. Don't mention reviewers, models, or AI.
- The body is a one-line summary, followed by any findings that couldn't go inline.
- Write the payload to a temp file and post it:
  ```sh
  gh api -X POST repos/OWNER/REPO/pulls/N/reviews --input review.json
  ```
  with `{"commit_id": "<headRefOid>", "event": "<verdict>", "body": "...", "comments": [{"path": "...", "line": 42, "side": "RIGHT", "body": "..."}]}`.
- If GitHub rejects an inline comment's line with a 422, move that finding into the body and post again. Don't post twice successfully.
- Delete the throwaway checkout when done.

### Report
- **Target:** the PR URL, `BASE`, and `HEAD`.
- **Posted:** the verdict, the review URL, and each finding posted with its reviewer.
- **Rejected:** each finding with its one-line reason (including "unverified" and "already raised"), so I can overrule you and add it myself.
- **Overturn rate**, as in step 5.

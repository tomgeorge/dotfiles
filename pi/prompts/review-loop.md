---
description: Review a change with clean-context reviewers, fix accepted findings, and loop until they call it good; or, for a PR with no local checkout, review once and post the findings to the PR
argument-hint: "[here | PR | branch | worktree path | crew [slug] | A..B] [extra focus]"
---
Run a review-fix loop on target "${1:-here}". ${@:2}

I'm asking you to delegate reviews to subagents for this whole task. Use the models named below; don't ask me to pick.

## 0. Set up
Work out three things: `DIR`, the checkout where the change lives; `BASE`, the commit the change is measured against; and the change's intent.

`DEFAULT` is the repo's default branch: `git symbolic-ref --short refs/remotes/origin/HEAD`, falling back to `main`. Pick the first rule that matches the target:

- **`here` or nothing:** the work in the current checkout, such as what an agent or a team of agents just produced, committed or not.
  - `DIR` is the repo root.
  - On the default branch, `BASE=HEAD`, so only uncommitted work is reviewed.
  - On any other branch, `BASE=$(git merge-base $DEFAULT HEAD)`.
  - If there's nothing to review, say so and stop.
- **`crew` or `crew <slug>`:** a crew's integration branch.
  - Read the newest JSON file in `$(git rev-parse --git-common-dir)/pi-crew/`, or `<slug>.json`.
  - `DIR` is its `config.integrationPath`, and `BASE` is its `config.baseSha`.
  - The intent is its `config.goal` plus `summary`.
  - If the crew is still `active`, ask me first, because its workers may still be merging.
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
- Write a 2–4 sentence statement of the change's intent. Take it from the PR title and body, the crew goal, or what I asked for earlier in this conversation, plus my message here. That intent is the yardstick for every decision below. If you can't tell what the change is meant to do, ask me.

## 1. Review: all three in parallel, each with a clean context
Make three `subagent` calls in a single turn:
- cwd: `DIR`
- tools: `read`, `grep`, `find`, `ls`, `git`

Give each reviewer:
- the intent statement;
- `BASE`;
- the list of changed files from `git diff --stat $BASE` and `git status --porcelain`, both run in `DIR`. Name untracked new files explicitly, because `git diff` doesn't show them.

Don't give them your reasoning or earlier rounds' discussion. They should judge the code fresh.

| Reviewer | Model | Focus |
|---|---|---|
| A | `anthropic/claude-opus-5-5` | Correctness: logic errors, missed edge cases, broken invariants, concurrency, error handling. |
| B | `openai-codex/gpt-6.1-sol` | Security and robustness: injection, authz, secrets, unsafe input, resource leaks, failure modes. |
| C | `anthropic/claude-sonnet-5-5` | Tests and fit: missing or weak tests, behavior changes without tests, departures from the codebase's existing conventions, dead code. |

Reviewers asked to "find problems" invent them: in studies, models rejected 25–75% of correct code, and asking them to explain and fix made it worse. So don't presume a problem exists. Tell every reviewer:
- Use `git diff $BASE` to see the change, including uncommitted work, and read the new files directly.
- Read the surrounding code before judging it.
- **The bar:** report a finding only if it breaks correctness, security, or a stated requirement. Style, alternative designs, and "more tests would be nice" are not findings.
- **"If the change is correct and meets the stated requirements, say so and report no findings."** Write `No findings.` in that case. That is a good outcome, not a failed review.
- **Evidence:** every high or medium finding must include a concrete failing input, counterexample, or a test that would fail. A finding without one can be at most low.
- Report one finding per line, as `[high|medium|low] path:line: problem. Evidence: ...`. Don't propose fixes; the fix comes later, after the evidence holds up.
- In rounds 2 and later, also send the "already decided" list (see below), with the instruction: "Don't re-raise these unless the code changed in a way that makes them newly relevant."

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

Add every rejected and deferred finding to the "already decided" list.

## 3. Fix and verify
- Fix each accepted finding until its failing test passes (green). Change only what the finding names, minimally, in the existing style. Don't add abstractions, defensive checks, or options that no finding asked for.
- You may skip a fix that seems unsafe or would need a wider change. List it as unresolved instead of forcing it.
- Run all the checks in `DIR`. Fix any failures your changes caused.
- Don't commit, push, or change git history. Leave the changes uncommitted in `DIR` for me. For a crew target, this means the integration branch's worktree.

## 4. Loop or stop
- **Stop** when a round produces no accepted high or medium findings and the checks pass. That's "the reviewers call it good."
- **Otherwise** start another round from step 1, with fresh subagent calls and the "already decided" list. Rounds 2 and later review **only this round's fix diff** (`git diff` of your changes since the previous round) against the accepted findings, not the whole change again. A full re-review just generates new findings forever.
- **Hard limit:** 3 rounds. If high or medium findings remain after round 3, stop.
- If the same issue survives two fix attempts, stop and escalate it to me instead of looping.

## 5. Report
Keep it short.
- **Target:** `DIR` and `BASE`.
- **Verdict:** clean after N rounds, or stopped at the limit with issues left.
- **Fixed:** each finding, its reviewer, and what changed (path:line).
- **Rejected and deferred:** each finding with its one-line reason (including "unreproduced"), so I can overrule you.
- **Overturn rate:** findings raised vs accepted. If most were rejected, say so; the reviewers are overcorrecting on this code.
- **Unresolved:** anything still open, with your recommendation.
- **Checks:** the commands run and their final status.
- **Spend:** the total subagent cost reported by the jobs.

## Review-only mode: a PR with no local checkout
One round of review, no fixes, then a review posted to the PR from my GitHub account (`gh` is authenticated as me): request changes if findings survive, approve if none do. Steps 1 and 2 apply with the changes below; steps 3 and 4 don't.

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
Run step 1 as written, with `DIR` the throwaway checkout. Have reviewers use `git diff $BASE $HEAD`; there is no uncommitted work.

### Triage
Run step 2, but you can't execute tests, so reason instead. Accept a high or medium finding only if you can name the exact input or scenario that fails and trace it through the code in `DIR`. Otherwise reject it as unverified. Also reject anything already raised in the PR's existing comments or reviews.

### Post
Pick the verdict:
- **Any accepted finding:** `REQUEST_CHANGES`, with the findings as below.
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
- **Overturn rate** and **Spend**, as in step 5.

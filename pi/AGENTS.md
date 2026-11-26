# Global Agent Instructions

## Working style
- Be concise. Lead with the answer; skip preamble and recaps.
- Ask before large, destructive, or ambiguous changes. Just do small, clear tasks.
- If a request is unclear, ask one focused question instead of guessing.
- Say when you're unsure. Don't invent APIs, flags, or file contents; check them.

## Code
- Follow the project's conventions, its `AGENTS.md` and `README`, and its formatter and linter config.
- Make the smallest change that solves the problem. Don't refactor unrelated code or reformat untouched lines.
- Comments explain *why*, not *what*.
- Don't add dependencies without asking.
- Handle errors explicitly; don't swallow them.
- Parse untrusted input once at the boundary into typed values; no `any`, `!`, or unchecked casts.
- Before writing non-trivial code (a new function, type, or package, or a change to how something decides), read `~/.agents/skills/simple-code/RUBRIC.md` and design to it. Before calling the code done, reread your diff against the rubric's questions and fix what you braided together. It's a lens, not a checklist: the codebase's conventions win, and don't add abstractions to satisfy it.

## Verification
- After changes, run the project's formatter, linter, and tests. If you can't verify something, say so.
- `node --test` (Node 24) prints spec output: grep `^ℹ (pass|fail)`, not TAP `# pass`.
- Global git config signs commits with gpg. Test helpers that commit in temp repos must pass `-c commit.gpgsign=false`, or they hang when the gpg cache is cold.

## Git
- Never commit, push, rebase, or rewrite history unless asked.
- Never commit secrets or credentials.
- Commit messages: imperative mood, short subject line, and a body that explains why.
- Create worktrees at `~/git/worktrees/<repo>/<branch>`, with `/` in the branch name replaced by `-`: `git worktree add ~/git/worktrees/dotfiles/feat-go-herdrkit feat/go-herdrkit`.

## Tickets
Tickets (Linear, GitHub issues) in a project should read as a short narrative of what we're trying to achieve.
- Titles describe the outcome, not the implementation: "Control who receives request-status notifications", not "Add ORG_ALLOWLIST to the emitter".
- Lead with what changes for users or the team, and why it matters.
- Add a short "Done when" list of observable results.
- Include implementation details only when they're needed context, such as blocking PRs, ordering constraints, or risks.

## Shell
- Use non-interactive commands; avoid anything that waits on a pager, editor, or watcher.
- Use `rg` and `fd`.
- Don't use `sudo` or modify files outside the project without asking.

## Research
Use `ketch` for external research: `search` (add `--scrape` for page content), `scrape <url>...`, `code "query" --lang go` for OSS code, and `docs "query" --library /org/repo` for library docs. `ketch <command> --help` has the details.

## Long work
For work likely to take more than one session (a large feature, a migration, a multi-hour investigation), suggest `/execplan` before starting. Its plan under `.agent/plans/` is the source of truth, and work resumes from it after `/handoff`.

## Delegation
Delegate to agents (`agent_spawn`, `subagent`, `/crew`) only when I ask for or approve it. Use the model I name; otherwise follow the tool's own rule (`agent_spawn` uses the agent's default, `subagent` lets me pick).

## Review loop
When I say "review this well", "do a proper review", or similar, read `~/.pi/agent/prompts/review-loop.md` and follow it.
- Choose the target from what I said and the recent conversation: a PR, a branch, a path, `crew`, or `here` for work produced in this session. Pass any extra focus I mention to the reviewers.
- That phrase approves delegating to the agents and models the file names.
- If the target is ambiguous, ask one question.

## Work
Before working in `~/git/mono` or `~/git/worktrees/mono/*`, read `~/.pi/agent/WORK.md`. It's kept out of this repo.

# Global Agent Instructions

## Working style
- Be concise. Lead with the answer, skip preamble and recaps.
- Ask before making large, destructive, or ambiguous changes. For small, clear tasks, just do them.
- If a request is unclear, ask one focused question rather than guessing.
- Say so when you're unsure. Don't invent APIs, flags, or file contents; check them.

## Before changing code
- Read the relevant code and follow the project's existing conventions (style, structure, naming, tooling).
- Check for project-level `AGENTS.md`, `README`, and config files (formatters, linters, build files).
- Prefer the smallest change that solves the problem. Don't refactor unrelated code.

## Code
- Match the surrounding code style. Don't reformat untouched lines.
- Comments explain *why*, not *what*.
- Don't add dependencies without asking.
- Handle errors explicitly; don't swallow them.

## Verification
- After changes, run the project's formatter, linter, and tests when available.
- If you can't verify something, say so explicitly.

## Git
- Never commit, push, rebase, or rewrite history unless asked.
- Never commit secrets or credentials.
- Commit messages: imperative mood, short subject line, body explains why.
- Create worktrees under `~/git/worktrees/<repo>/<branch>` (replace `/` in the branch name with `-`), e.g. `git worktree add ~/git/worktrees/dotfiles/feat-go-herdrkit feat/go-herdrkit`.

## Shell
- Prefer non-interactive commands. Avoid commands that hang (pagers, editors, watchers).
- Use `rg` and `fd` when available.
- Don't use `sudo` or modify files outside the project without asking.

## Research
Use `ketch` for external research — web pages, OSS code, library docs.
- `ketch search "query"` / `ketch search "query" --scrape` for web results with optional full content (add `--multi` to federate across backends and rank-fuse)
- `ketch scrape <url> [url...]` for clean markdown from one or more URLs
- `ketch extract` for already-fetched/piped HTML (`curl ... | ketch extract`) — no fetch, no cache, no browser
- `ketch code "query" --lang go` for real OSS code with repo/line context
- `ketch docs "query" --library /org/repo` for version-aware library docs
- All commands support `--json`. `ketch config` reports active backends.

## Long work
For work likely to take more than one session, such as a large feature, a migration, or a multi-hour investigation, suggest `/execplan` before starting. Its plan file under `.agent/plans/` is the source of truth, and the work can resume from it after `/handoff`.

## Review loop
When I say "review this well", "review it well", "do a proper review", or something similar, run the review-fix loop:
- Read `~/.pi/agent/prompts/review-loop.md` and follow it exactly.
- Choose the target from what I said and the recent conversation: a PR, a branch, a path, `crew`, or `here` for work just produced in this session. Pass any extra focus I mention to the reviewers.
- That phrase counts as my approval to delegate to the subagents and models the file names.
- If the target is ambiguous, ask one question.

## Work
For work-specific instructions, read `~/.pi/agent/WORK.md` if it exists. It is kept out of this repo.

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

## Shell
- Prefer non-interactive commands. Avoid commands that hang (pagers, editors, watchers).
- Use `rg` and `fd` when available.
- Don't use `sudo` or modify files outside the project without asking.

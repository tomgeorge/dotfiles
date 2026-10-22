---
description: Weekly harness retro. Mine recent agent sessions for friction and propose (never apply) fixes to instructions, prompts, and tools
argument-hint: "[days, default 7]"
---
Run a harness retro over the last ${1:-7} days of agent sessions. You propose changes; you never apply them. I decide.

## 1. Collect
Run `node ~/.pi/agent/retro/collect.ts --days ${1:-7} --max 15`. It reads Pi sessions (`~/.pi/agent/sessions`) and Claude Code sessions (`~/.claude/projects`), and lists recurring errors, my corrections, repeated identical tool calls, and interrupts, each with a `file:line` reference.

## 2. Verify every signal
A signal is a lead, not a finding. For each promising one, open the transcript at the cited line and read enough around it to understand what happened. Then decide:
- **Keep:** an instruction, prompt, skill, or tool is missing, wrong, or misleading, and that caused the friction.
- **Drop:** it isn't friction at all. Examples: `diff` or `grep` exiting 1 as the answer, an expected failure while debugging, or me answering a question with "no".
- **One-off:** a real mistake that's unlikely to recur. Skip it.

Blame the instructions, not the agent: "AGENTS.md doesn't say this machine has GNU sed" is a gap; "the agent forgot" is not.

Read the surfaces a fix might land in, so you don't propose something that already exists:
- global instructions: `~/.pi/agent/AGENTS.md`, `~/.claude/CLAUDE.md`;
- the repo's own `AGENTS.md` or `CLAUDE.md`, for repo-specific friction;
- prompts in `~/.pi/agent/prompts/`, skills in `~/.claude/skills/`, and extensions in `~/git/dotfiles/pi/extensions/`.

## 3. Propose
Write at most **8 proposals**. That's a cap, not a target. A quiet week gets a three-line digest. Don't invent findings to fill it.

Put each fix on the smallest surface that holds it:
- A deterministic rule goes in a hook, lint, test, or tool change. These are stronger than prose, because a remembered rule still gets violated.
- A recurring procedure goes in a prompt template or skill.
- A fact or convention goes in one AGENTS.md line.

Each proposal has exactly these fields:
- **Signal:** what happened, how often, with one or two `file:line` references.
- **Target:** the file to change.
- **Change:** the exact text or diff.
- **Check:** how we'll know it worked. Prefer a command; otherwise, the friction to look for absent in the next retro.

Also suggest **removals**: instructions that never fired, or that contradict how I actually work. Every line costs context in every session.

## 4. Write the digest
Write it to `~/.local/state/pi-retro/$(date +%F).md`. Start with one line of totals (sessions, tool calls, failures), then the proposals, then a short list of dropped signals with the reason for each, so the next retro doesn't re-examine them. Read the previous digest in that directory if one exists, and note which of its proposals I applied, and whether the friction went away.

**Never edit any file except the digest.** Finish by showing me the proposals as a numbered list, so I can answer with something like "apply 1, 3; drop 2".

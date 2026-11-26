# Audit agent steering files for clarity and usage

## Purpose
"Steering files" are the text an agent reads as instructions: global instruction files, prompt templates, agent definitions, skills, and the tool descriptions that extensions register. After this work:

1. Each steering file states its intent clearly and concisely for strong models (Claude Opus 5.5, Fable, Astra and similar). Wording that doesn't change behavior is gone, and the files don't contradict each other.
2. A usage report ranks every skill, prompt, agent, tool and extension by how often it has actually been used, so Tom can decide what to keep, merge or remove.

To see it working, read any audited file: its first lines say what it's for, and every remaining line serves that. Read `.agent/plans/steering-audit-usage.md` for the ranking.

## Context
How steering reaches the agent (from `nix/modules/features/pi.nix`):
- `pi/AGENTS.md` is linked to `~/.pi/agent/AGENTS.md`, the global instructions. It tells the agent to read `~/.pi/agent/WORK.md`, which lives outside this repo (chainctl and mono-repo notes).
- `pi/prompts/` is linked to `~/.pi/agent/prompts`. These are slash-command templates (`/review-loop`, `/rex-crew`, `/execplan`, `/retro`, `/checkin`). When one is invoked, pi stores the expanded text in the transcript, not the command name.
- `pi/agents/` is linked to `~/.pi/agent/agents`. These define `scout`, `reviewer` and `crew-worker` for the pi-rex-agents package and override its bundled agents of the same name.
- `agents/skills/` is linked to `~/.agents/skills`, and `claude/skills/` to `~/.claude/skills`. pi reads both; Claude Code reads `~/.claude/skills`. Each skill is a directory with a `SKILL.md` whose frontmatter `description` sits in the system prompt. The agent reads the body when the description matches the task.
- Extensions under `pi/extensions/` (enabled: advisor, crew, goal, handoff, hey-organize, mcp-confirm, subagent, vi-mode, watch) register tools whose descriptions and prompt guidelines are part of the system prompt.
- Pinned pi packages add more: `pi-rex-agents` (`agent_spawn` and friends), `pi-rex-btw`, `pi-rex-shell`, `pi-google-workspace`, and `samber/cc-skills-golang` (about 40 golang-* skills).

Ownership:
- **Owned here, edit directly:** `pi/AGENTS.md`, `~/.pi/agent/WORK.md`, `pi/prompts/*`, `pi/agents/*`, `pi/WORKFLOW.md` (a human playbook that must agree with the steering), the skills approve-pr, simple-code, arts-artifact, arts-report, rex (agents/skills), grilling, weekly-review, google-style, writing-clearly-and-concisely (claude/skills), and the tool descriptions in `pi/extensions/*/index.ts`.
- **Generated or third-party, read only:** `agents/skills/hey` (written by the hey CLI's skill installer), terminal-browser (a symlink into the installed app), the golang-* skills, pi-rex-* and pi-google-workspace. `claude/skills/rex` and `claude/skills/hey` may be copies or links of agents/skills ones; check. For these, record proposed fixes to send upstream, but don't edit them.
- `writing-clearly-and-concisely/elements-of-style/*` and `signs-of-ai-writing.md` are reference text the skill points at. Audit only `SKILL.md` and how it points at them.

Known overlaps to resolve with Tom, not unilaterally: the `subagent` and `crew` extensions are still enabled next to pi-rex-agents' `agent_spawn` and `/rex-crew`.

Usage data:
- pi transcripts: `~/.pi/agent/sessions/**/*.jsonl`, 349 sessions from 2026-09-23 to 2026-11-26. Each line is JSON; `type=="message"` entries hold `message.role` and `message.content`. Tool calls are assistant content items with `type=="toolCall"`, `name` and `arguments`.
- Claude Code transcripts: `~/.claude/projects/**/*.jsonl` (63 files), in Claude Code's own format.
- `pi/retro/collect.ts` already parses both formats for `/retro`; reuse its parsing if that helps.

## Standard for each file
1. Write the file's intent in one line. Every remaining line must serve it.
2. Cut what doesn't change behavior: generic advice strong models already follow, rules repeated across files, MUST/ALL-CAPS emphasis, and explanations that steer nothing.
3. Keep what does change behavior: permissions, safety limits, tool and API constraints, output formats, and steps the agent couldn't guess. A rule that exists because of an observed failure stays. Check `git log -L` or `git log -S` only when a rule's purpose is unclear.
4. Make tool names, file paths and cross-references agree. Check frontmatter, `$@`/`${1}` substitutions, and that every named tool, file and command exists.
5. For skills, the `description` decides when the skill loads. Make it say what the skill does and when to use it, without padding.

## Plan of work

### Milestone 1: usage report
Goal: know what's used before deciding what to trim or remove.
Work: write a throwaway script (in `/tmp`, not the repo) that scans both transcript sets and counts, per item:
- tool calls by name, including tools called inside `codemode` scripts (`tools.<name>(` in `arguments.code`);
- skill loads: `read` calls on a `SKILL.md` path, and `<skill name="...">` blocks in user messages;
- prompt templates, matched by a distinctive opening line of each expanded template (for example "Run a review-fix loop on target" for `/review-loop`);
- agent definitions, from `agent_spawn` calls' `agent` argument;
- last-used date for each item, and counts for the last 30 days against all time.
List every owned item with zero uses. Note the window: two months of pi data is short, and a skill used monthly may show once.
Result: `.agent/plans/steering-audit-usage.md` with most-used, least-used and unused items, and the method's blind spots.
Proof: a spot check of three counts by hand with `rg` matches the script.

A prototype already worked: in pi transcripts, bash 15091, read 927, codemode 358, watch 175, crew_dispatch 121, subagent 106, advisor 59. Skill reads: rex 33, approve-pr 21, arts-artifact 7, writing-clearly 6, google-style 5, simple-code 5, weekly-review 1. review-loop expanded 4 times, execplan once, rex-crew never yet.

### Milestone 2: global instructions and agent definitions
Goal: set the standard on the files every session loads.
Work: audit `pi/AGENTS.md`, `~/.pi/agent/WORK.md`, `pi/agents/*`, against the standard. Present the diff to Tom with each file's intent, what was cut and why, and open questions, before going on.
Result: Tom agrees with the standard as applied.

### Milestone 3: prompts
Work: audit `pi/prompts/*` and make `pi/WORKFLOW.md` agree with them. Raise the subagent/crew versus agent_spawn/rex-crew overlap with the usage numbers.

### Milestone 4: owned skills
Work: audit each owned skill's `SKILL.md` and references, most used first. For unused skills, recommend keep, merge or remove, with the usage numbers.

### Milestone 5: tool descriptions
Work: audit the `description`, `promptSnippet` and guideline strings each enabled extension registers. Run the extension type check and tests after edits.

### Milestone 6: third-party notes
Work: list proposed fixes for generated and third-party steering, by source, in the usage report.

## Validation
- After each milestone: `git diff --stat` shows only intended files. For every edited file, list the tool names, paths and commands it references, and confirm each exists (`rg`, `ls`, or the pi tool list in a live session).
- Skills: frontmatter parses (`name` and `description` present), and `name` matches the directory.
- Prompts: `description` and `argument-hint` present, and placeholders (`$@`, `${1:-...}`, `${@:2}`) still in place.
- Extensions: run each edited extension's tests as its README says (`node --test pi/extensions/<ext>/*.test.ts`), and the repo's type check if there is one. Grep `^ℹ (pass|fail)`.
- In a fresh pi session after `/reload`, invoke one audited prompt and one audited skill to check they still load and behave.

## Progress
- [x] 2026-11-26 Inventory steering files and how they load.
- [x] 2026-11-26 Prototype usage counting on pi transcripts.
- [x] 2026-11-26 Milestone 1: usage report in `.agent/plans/steering-audit-usage.md`. Spot checks: rex and approve-pr skill reads match the `rg` prototype plus `cat` reads.
- [x] 2026-11-26 Milestone 2: `pi/AGENTS.md`, `~/.pi/agent/WORK.md`, `pi/agents/*`. Tom approved the standard.
- [x] 2026-11-26 Milestone 3: prompts (review-loop, retro, checkin, rex-crew; execplan unchanged) and `pi/WORKFLOW.md`.
- [x] 2026-11-26 Milestone 4: owned skills (approve-pr, simple-code, arts-artifact, arts-report, grilling, weekly-review, google-style, writing-clearly). Frontmatter checked with a node script. arts-* reference files and RUBRIC.md left as reference material.
- [x] 2026-11-26 Milestone 5: tool descriptions. Only two small edits (crew_wake, subagent); the rest were already tight. `node --test crew/*.test.ts subagent/*.test.ts`: 152 pass, 0 fail. No local `tsc`, so no type check (string-only changes).
- [x] 2026-11-26 Milestone 6: notes in the usage report.
- [x] 2026-11-26 Advisor pass: restored the capture approval gate in weekly-review and replaced its guessed pi tool names with "find them with searchTools"; made the usage script reproducible (`.agent/plans/steering-audit-usage.mjs`, excludes this session, dedupes entries, validates skill names); read the crew, goal, advisor and handoff prompts that extensions inject (only the crew reviewer prompt changed: it now says a clean review is a good outcome); read the arts reference files and the terminal-browser skill; moved the map steps out of arts-artifact's SKILL.md, since `references/interactive-map.md` already has them; parsed all frontmatter with yq; ran the arts-report build and quiz check; `node --test crew/*.test.ts`: 100 pass.
- [ ] Remaining: Tom reviews the diff; `/reload` smoke test of one prompt and one skill in a fresh session; commit when Tom says.

No commits without Tom's say-so; changes stay uncommitted.

## Surprises & Discoveries
- `pi/extensions/test-support/typecheck.sh` is broken with the current pi install: it looks for `lib/node_modules/pi-monorepo` under the nix store path, which pi 1.6.0 doesn't have. Not fixed here.
- pi-rex-agents isn't installed yet (no home-manager switch since it was added), so its README was checked from a clone at the pinned commit: `kind`, `tools` and `ask_parent` are as the agent definitions use them.
- The goal extension has never been used, and retro and hey-organize almost never.
- pi stores invoked prompt templates expanded, so templates have to be matched by their text, not their slash-command name.
- Skills no longer installed still show in transcripts (go-standards, fut, dev-env, e2e-coverage). The report should separate current from removed items.

## Decision Log
- 2026-11-26: Remove the grilling skill (Tom); drop its rows from `WORKFLOW.md`.
- 2026-11-26: Keep subagent and crew alongside agent_spawn and rex-crew (Tom). `WORKFLOW.md` now says: Rex-backed tools in Rex, the extensions elsewhere.
- 2026-11-26: Keep goal and hey-organize; tighten only (Tom).
- 2026-11-26: weekly-review: name the active projects once, state each HEY safety rule once (they were repeated three times), and map Claude connector tool names to pi's MCP names. grilling: drop "dispatch a sub-agent", which conflicted with the delegation rule.
- 2026-11-26: In `AGENTS.md`, load `WORK.md` only for mono work, since everything in it is mono-specific. Merge the duplicated "follow conventions" and "minimal change" bullets; drop the simple-over-easy bullet, which `RUBRIC.md` already covers; shrink the ketch section, since `ketch --help` documents itself.
- 2026-11-26: Agent definitions: drop lines their tool allowlists already enforce ("never edit") and generic advice ("read before you write").
- 2026-11-26: Include `~/.pi/agent/WORK.md` (Tom said yes). Read third-party steering, but only record fixes for upstream; edits to installed copies would be overwritten.
- 2026-11-26: Usage first, so trimming and removal decisions use evidence.
- 2026-11-26: Don't remove subagent or crew without Tom's decision.

## Outcomes & Retrospective
(Filled in at the end.)

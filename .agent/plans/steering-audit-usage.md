# Steering usage report

Source: 349 pi sessions (2026-09-23 to 2026-11-26) and 63 Claude Code transcripts (2026-11-04 to 11-05 only). Counted by `node .agent/plans/steering-audit-usage.mjs --exclude <this audit's session file>`, which skips the audit's own reads and counts entries replayed into forked sessions once. "Sessions" is how many sessions used the item at least once; "30d" is uses since 2026-10-27.

## Owned items

### Skills (loads: a `read` of the SKILL.md, or an injected `<skill>` block)
| Skill | Loads | Sessions | 30d | Last |
|---|---|---|---|---|
| rex | 40 | 37 | 40 | 11-26 |
| approve-pr | 26 | 25 | 22 | 11-19 |
| arts-artifact | 15 | 10 | 10 | 11-21 |
| writing-clearly-and-concisely | 12 | 10 | 7 | 11-26 |
| google-style | 9 | 5 | 3 | 11-26 |
| simple-code | 6 | 6 | 5 | 11-02 |
| grilling | 3 | 2 | 1 | 11-26 |
| weekly-review | 2 | 2 | 1 | 11-26 |
| arts-report | 1 | 1 | 1 | 11-02 |

simple-code is undercounted: `AGENTS.md` sends the agent to `RUBRIC.md` directly, and those reads don't count as skill loads.

### Prompts (matched by the expanded template's text)
| Prompt | Uses | Last |
|---|---|---|
| review-loop | 4 | 11-02 |
| execplan | 1 | 11-04 |
| rex-crew | 0 | new on 11-25 |
| retro | no observed use | — |
| checkin | not measurable | runs as `pi -p --no-session` from launchd |

### Agent definitions (pi-rex-agents)
scout, reviewer and crew-worker: 0 `agent_spawn` calls so far. They're new (11-25).

### Extensions (tool calls or the messages they post)
| Extension | Evidence | Sessions | Last |
|---|---|---|---|
| watch | 175 watch, 27 watch_list, 23 watch_stop, 3 loops | 50 | 11-25 |
| crew | 121 crew_dispatch, 64 crew_integrate, 120 handoffs | 8 | 11-03 |
| subagent | 106 direct calls + 41 from codemode | 22 | 11-23 |
| advisor | 59 | 41 | 11-26 |
| mcp-confirm | runs on every MCP call; no usage signal of its own | — | — |
| handoff | unknown: its prompt leaves no reliable marker; 1 likely | — | — |
| hey-organize | 1 hey_seen | 1 | 10-19 |
| goal | no observed use (no goal_park calls, no goal messages) | 0 | — |
| vi-mode | editor mode; no signal | — | — |

### Global instructions
`pi/AGENTS.md` and `~/.pi/agent/WORK.md` load every session. Usage doesn't apply; cost does, because every line is paid for every turn.

## Third-party and other items
- golang-* skills (samber): 4 loads in total, all in one session (11-05).
- hey skill: 1 load. hey CLI calls in bash: 39 across 7 sessions. The hey MCP via codemode is used in 1 session (10-19).
- terminal-browser: 2 loads, 1 CLI call (new).
- Pinned pi packages: codemode 358 calls in 75 sessions, mostly for Slack MCP. Tools inside codemode are counted as references in the script source (about 150 to Slack), not confirmed executions. pi-google-workspace: 4 calls in total.
- CLIs in bash: gh 2183 (218 sessions), rex 765 (38), ketch 185 (57), chainctl 87 (26).

## Most and least used
- **Most used:** watch, codemode, subagent, advisor, crew, and the rex, approve-pr and arts-artifact skills. The top owned steering beyond `AGENTS.md` is the rex skill (loaded in about 1 in 10 sessions).
- **Least used or no observed use:** goal (none), retro (none), hey-organize (1 call), handoff (probably 1), arts-report (1), weekly-review (2), grilling (3), golang-* skills (one session), pi-google-workspace (4 calls).
- **Not yet measurable:** rex-crew and the three agent definitions (new); checkin (no session saved).

## Blind spots
- Claude Code transcripts cover two days only, so skills used mainly there (google-style, weekly-review, grilling) may be undercounted.
- Two months is short; monthly skills like weekly-review can show once or twice.
- Skills the agent read with tools other than `read` or `cat`, or loaded through `/skill:name` without the `<skill>` marker, are missed.
- Skills that are no longer installed still appear (go-standards 24, e2e-coverage 12, fut 6 and others). They come from other repos or have been removed, so they're left out of the tables above.

## Notes for upstream and config (milestone 6)
- **golang-* skills (samber/cc-skills-golang):** about 45 skill descriptions sit in every pi session's system prompt, yet they were loaded in one session in two months. The cheapest fix is ours, not upstream's: narrow the package in `nix/modules/features/pi.nix` with the object form, e.g. `{ source = "git:github.com/samber/cc-skills-golang@…"; skills = [ "skills/golang-how-to" "skills/golang-code-style" … ]; }`, keeping the handful you use. `golang-how-to` loads the others on demand. Not changed; needs Tom's call.
- **hey skill (written by `hey skill install`):** clear and current with CLI 1.13.1. Its Authentication section is written for Codex's macOS sandbox; under pi it's harmless noise. Nothing to send upstream that matters.
- **rex skill (written by `rex skill setup`):** a stub that runs `rex __internal skill`. Fine. It's installed in both `agents/skills/rex` and `claude/skills/rex`; pi shows it once.
- **terminal-browser:** upstream skill, linked from the installed app. Clear; one wordy paragraph about running `terminal-browser action done` after the last action could be one sentence. Nothing that conflicts with ours.
- **pi-rex-agents:** its bundled `worker` definition spawns scouts on its own. That's fine: scouts don't need approval (Tom, 2026-11-26).
- **pi-google-workspace:** its tool list is in every system prompt for 4 calls in two months. Narrowing it is a config choice like the golang one.
- **Apple Notes in pi:** weekly-review needs Apple Notes, but pi's MCP config has no Apple Notes server, so in pi it stops at the connectivity check. Either add a server or keep running weekly reviews in Claude.

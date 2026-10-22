# How I work with agents

This is a playbook for the Pi setup in this repository. Every tool here exists because the research behind it (see each README) showed a failure mode it fixes.

## Pick the tool by situation

| Situation | Use | Why |
|---|---|---|
| Small, clear change | Plain prompt. Start with "First run the tests"; say "use red/green TDD" | Models already know both shorthands |
| Unclear what to build | "grill me" (the grilling skill) | Find the gap before any code exists |
| Read-only research or review on the side | `subagent` | A clean context; nothing written |
| A finish line you can check, but an uncertain path (flaky test, perf target, migration step) | `/goal <objective> --check <cmd> [--max N]` | The check decides "done", not the model |
| Multi-session work (big feature, long investigation) | `/execplan <task>`, then `/handoff continue <plan>` when context fills | The plan file is the memory |
| Work that splits into independent, checkable pieces | `/crew <goal>` | A planner plus isolated workers; the harness merges |
| Hard decision, error recurring, about to declare a big task done | The agent calls `advisor` (set the model once with `/advisor`) | A second model, ideally from another vendor, sees the full transcript |
| Code is written; check it before I read it | "review this well" or `/review-loop [target]` | Three clean-context reviewers; findings must reproduce as failing tests |
| Context getting long or drifting | `/handoff <next goal>` | A fresh, focused session instead of lossy compaction |
| Waiting on CI or a deploy | Ask for a watch ("tell me when CI finishes") | A shell check loops; the model wakes only when it's true |
| Weekly | Weekly review, then its harness-retro step, or `/retro` | Turn repeated friction into fixes. Proposals only; I approve |
| Mail, tasks, calendar | `pi/checkin/run.sh` runs on its own twice a day; `/checkin` on demand | Only up to 3 things that need me; otherwise silence |

## A typical feature

1. If it's fuzzy: "grill me about X." If it's big: `/execplan X`, read the plan, and say go.
2. Implement with a plain prompt, or `/goal … --check "make test"` when the check is the finish line.
3. "review this well." Read its rejected findings and overturn rate before trusting it.
4. Read the diff myself, in small commits. Never ship code I haven't reviewed.
5. If an agent did something dumb along the way, add one line to AGENTS.md or a check now, not later. Or wait for `/retro` to catch it.

## Attention rules

- **Run only as many coding agents as I can review.** Usually one writing code I'll merge, plus research I can ignore for an hour.
- **Unblock before reviewing.** A blocked agent loses time every minute; a finished one loses nothing. In fut, `prefix u` opens Notifications (blocked agents first, Enter jumps there), and pressing the prefix twice jumps to the next waiting agent. `prefix a` lists all agents.
- **Pull, don't push.** Check agents at natural breaks. fut's unread markers are passive on purpose; don't add desktop notifications for agents. The check-in is the one exception: it notifies only when something real is due.
- **Loops are for checkable work** (ports, perf experiments, research, triage), not for code whose design I care about.

## Where things live

- Instructions: `pi/AGENTS.md`. Every line should trace back to an observed failure.
- Prompts: `pi/prompts/`: `review-loop`, `execplan`, `retro`, `checkin`.
- Extensions: `pi/extensions/`: `subagent`, `crew`, `goal`, `advisor`, `handoff`, `watch`, `mcp-confirm`.
- Session mining: `pi/retro/collect.ts`. Digests are written to `~/.local/state/pi-retro/`.
- Check-in: `pi/checkin/run.sh`, scheduled by `nix/modules/features/pi-checkin.nix`. State and results are in `~/.local/state/pi-checkin/`.

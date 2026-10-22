# How I work with agents

This is a playbook for the Pi setup in this repository. Every tool here exists because the research behind it (see each README) showed a failure mode it fixes.

## Pick the tool by situation

| Situation | Use | Why |
|---|---|---|
| Small, clear change | Plain prompt. Start with "First run the tests"; say "use red/green TDD" | Models already know both shorthands |
| Unclear what to build | "grill me" (the grilling skill) | Find the gap before any code exists |
| Read-only research or review on the side | `subagent` | A clean context; nothing written |
| A finish line you can check, but an uncertain path (flaky test, perf target, migration step) | `/goal <objective> --check <cmd> [--max N]` | The check decides "done", not the model |
| Code needs tests that would catch real breakage | List mutants in `<ext>/mutants.json`, then `/goal … --check node pi/extensions/test-support/mutate.ts <ext>` | "Tests pass" is met by an empty file; "every named mutant is killed" isn't |
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
3. "review this well." Read its rejected findings and overturn rate before trusting it. Expect the worst bugs in the *fixes*, so rounds 2 and later review only the fix diff.
4. Read the diff myself, in small commits. Never ship code I haven't reviewed.
5. If an agent did something dumb along the way, add one line to AGENTS.md or a check now, not later. Or wait for `/retro` to catch it.

## Attention rules

- **Run only as many coding agents as I can review.** Usually one writing code I'll merge, plus research I can ignore for an hour.
- **Unblock before reviewing.** A blocked agent loses time every minute; a finished one loses nothing. In fut, `prefix u` opens Notifications (blocked agents first, Enter jumps there), and pressing the prefix twice jumps to the next waiting agent. `prefix a` lists all agents.
- **Pull, don't push.** Check agents at natural breaks. fut's unread markers are passive on purpose; don't add desktop notifications for agents. The check-in is the one exception: it notifies only when something real is due.
- **Loops are for checkable work** (ports, perf experiments, research, triage), not for code whose design I care about.

## What dogfooding taught (2026-10)

Running these tools on their own code, `.agent/plans/dogfood-agent-tools.md` found:

- **Reviewers from different vendors pay off.** They often found the same bug on their own, and GPT found Pi runtime bugs by reading Pi's source. "No findings" from a reviewer was common and usually right.
- **A fix is the riskiest code in the loop.** In crew, each review round found new holes in the previous round's guard fix: bypasses, then an exponential regex. When a fix to the same code is wrong twice, change approach (a parser instead of a regex) rather than patch again.
- **A probe must observe what is actually sent.** Read `before_provider_request`, not a getter, and use unguessable payloads (`openssl rand -hex 4`). A getter gave a false green, and a guessable marker let the model infer the answer.
- **Pi doesn't emit `before_agent_start` for runs an extension starts** (`sendMessage({ triggerTurn })`). Put rules in tool `promptGuidelines` or in the message itself.
- **The advisor is a second opinion, not an oracle.** It added real cases (drain the in-flight tools too; the mutation gate counted timeouts as kills). It was also wrong twice about facts it couldn't see. Check its claims like a reviewer's.
- **`/goal` with a mutation gate wrote a crew test suite unattended, in one run.** Spot-check that the agent didn't edit the gate. Use checksums.
- **When a green suite goes red with no relevant diff, probe the tool first.** A gpg-agent cache timeout made every signing test commit hang.

## Where things live

- Instructions: `pi/AGENTS.md`. Every line should trace back to an observed failure.
- Prompts: `pi/prompts/`: `review-loop`, `execplan`, `retro`, `checkin`.
- Extensions: `pi/extensions/`: `subagent`, `crew`, `goal`, `advisor`, `handoff`, `watch`, `mcp-confirm`. Shared test helpers (a fake `ExtensionAPI` and the mutation gate) are in `pi/extensions/test-support/`.
- Session mining: `pi/retro/collect.ts`. Digests are written to `~/.local/state/pi-retro/`.
- Check-in: `pi/checkin/run.sh`, scheduled by `nix/modules/features/pi-checkin.nix`. State and results are in `~/.local/state/pi-checkin/`.

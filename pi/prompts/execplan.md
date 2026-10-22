---
description: Write and then execute a self-contained, living plan for multi-hour work (OpenAI's ExecPlan pattern)
argument-hint: "<what to build> | continue <plan path>"
---
Task: $@

If the task starts with `continue`, it names an existing plan. Read that plan in full and resume from its Progress section. Otherwise, write a new ExecPlan as described below, show it to me, and wait for my go-ahead before implementing.

## What an ExecPlan is
An ExecPlan is a design document that lets a reader who has **only this file and the working tree** deliver the change. It's also a log that stays current. It must always be possible to restart the work from the plan alone, after a context reset, a `/handoff`, or in another session.

Save it at `.agent/plans/<short-slug>.md` in the repository root, and tell me the path. Write in plain prose. Define every term that isn't ordinary English, and say where it shows up in this repo. Name files by their full repo-relative paths. Don't point at outside docs; restate what's needed in your own words.

Research before writing: read the relevant code, run the tests, and prototype anything uncertain. A small proof-of-concept milestone is better than a plan built on a guess.

## Required sections
- **Purpose:** what someone can do after this change that they couldn't before, and how to see it working.
- **Context:** the current state of the relevant code, for a reader who has never seen the repo.
- **Plan of work:** milestones as short stories (goal, work, result, proof). Each milestone must be independently verifiable, and it must leave the tests passing.
- **Validation:** the exact commands to run, their working directory, and the output that proves success. Phrase it as behavior a person can observe, for example "`curl localhost:8080/health` returns 200 OK," not "added a handler."
- **Progress:** a checklist of granular steps with timestamps. At every stopping point, update it to show what's done and what remains. Split partly done items into "done" and "remaining." This section must always match reality.
- **Surprises & Discoveries:** unexpected behavior, bugs, or constraints you found, with short evidence such as test output.
- **Decision Log:** every decision, with the date, the reason, and the alternatives rejected.
- **Outcomes & Retrospective:** filled in at the end. What was achieved, what remains, and lessons that should become AGENTS.md lines or checks.

## While implementing
- Don't ask me for "next steps." Proceed milestone by milestone, and resolve ambiguities yourself, recording each one in the Decision Log.
- Use red/green TDD where practical. Run the validation commands at the end of each milestone, and record what you saw.
- Commit at each verified milestone only if I've said commits are fine in this repo. Otherwise leave changes uncommitted and note that in Progress.
- Update Progress, Surprises, and the Decision Log as you go, not at the end.
- If your context fills up, update the plan, then tell me to `/handoff continue .agent/plans/<slug>.md`.
- Stop and ask me only when you need scope, credentials, or a decision that the plan can't settle.

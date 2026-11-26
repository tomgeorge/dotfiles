---
name: weekly-review
description: Run a Getting Things Done (GTD) weekly review across HEY mail, Fantastical (calendar), Todoist (tasks), and Apple Notes. Use when the user asks for a "weekly review", "GTD review", "weekly planning", or "weekly reset", or says "review the week", "plan my week", or "do my weekly", even without mentioning GTD. Not for quick task adds, daily planning, a calendar summary on its own, or a Screener sweep on its own.
---

# GTD weekly review

Walk the user through a weekly review. The output is Todoist updates and a review note in Apple Notes. Run the phases in order, and skip one only when the user says so (tell them what they're skipping). Be terse while gathering data and conversational while processing it. Batch every tool call that accepts an array.

Tool names below are the Claude connectors'. Other clients name the tools and their parameters differently; in pi they're MCP tools called through codemode. Find the equivalent with `searchTools` and read its schema with `describeTool` before calling it.

## The user's system
- **Todoist projects.** The **active projects** are Personal, Work (Chainguard), Wedding Planning, and Agendas (topics queued for specific people, for 1:1s). **Someday Maybe** is the parking lot: "move to someday" means move the task to that project, not a label. Plus the system Inbox.
- **Solo account.** Never filter by `responsibleUser`, which returns nothing for this user, including in `find-completed-tasks`. Use the default `unassignedOrMe` or omit it.
- **Two dates.** `dueDate` is when the user plans to work on a task; `deadlineDate` is when it must be done. Report deadlines separately.
- **`Waiting` label:** the user is blocked on someone else.
- **Calendars.** All calendars are in scope. **QGenda is the partner's clinical schedule** (STICU, Trauma, transplant nights), never the user's commitments: group it under "Partner's schedule" and use it as context ("partner on nights Wed–Fri"). In look-back summaries, skip standups, all-hands, recurring ops meetings, holidays and birthdays. In look-ahead summaries, skip standups and all-hands, but keep holidays, birthdays, travel and social events.
- **HEY is the user's email**, through two MCP servers split on purpose as a safety boundary. `hey` is read-only (threads, search, boxes). `hey-triage` can write, but only contacts: the Screener. HEY's calendar and todos aren't used; events go to Fantastical and todos to Todoist.
- **Never send, reply to, or forward email,** through MCP or the `hey` CLI. "I need to reply to that" becomes a Todoist task. Draft wording in chat if asked.
- **HEY's Imbox is already the signal.** Newsletters go to the Feed and receipts to the Paper Trail; don't scan those unless asked.
- **Apple Notes:** create the review note in the default location unless the user names a folder. Never delete notes.

## Tool quirks
- `Fantastical:queryCalendarItems` with only `when` (no `query`) returns everything in the window. Keep only `title`, `startDate`, `endDate` and `calendarId` from each event.
- `Todoist:find-tasks` takes filter strings (`"no date"`, `"overdue"`, `"7 days"`, `"##Project"`). `limit` must be ≤ 100; page with the returned cursor.
- HEY MCP tools take `{"action": "...", "params": {...}}`. `{"action": "describe", "params": {"action": "NAME"}}` returns an action's parameters; use it instead of guessing.
- A HEY box row has an `id` (the box item, for seen, unseen and move) and a `topic_id` (the thread, for reading). A `kind: "bundle"` row groups one sender's unseen threads and has no `topic_id`.
- "Clearance" means a Screener decision. `get_clearances` is the pending queue; `update_clearance` screens one sender in or out.
- Confirm these every time, on their own and never in a batch: `punt_clearances` (clears the **whole** Screener), `bulk_update_clearances` (screens senders **out** only, so approving several senders means several `update_clearance` calls), and `mark_box_seen` (marks a whole box seen).
- Marking single threads seen: `hey seen <box-item-id>...` in a shell, or `hey_seen` in pi. Claude Desktop has no per-thread action; say so, and don't fall back to `mark_box_seen`.

## Phase 0: Set up
1. Check that Fantastical, Todoist, Apple Notes, `hey` and `hey-triage` are available, with one cheap call each (`Todoist:user-info`, `Fantastical:queryCalendars`, `list_notes` with a small limit) to catch auth failures early. If HEY alone is missing, offer to run without mail triage. If anything else is missing or fails, name it and stop until the user fixes it.
2. The look-back window is the past 7 days and the look-ahead the next 7, from today. Don't ask.
3. `Todoist:find-projects` once; map the project names to IDs. If a name doesn't match exactly, use the closest and confirm once.
4. Tell the user: "Walking you through a GTD weekly review: capture, collect, get clear, mail, get current, stale sweep, plan the week. About 10 minutes."

## Phase 1: Capture
Get everything out of the user's head before touching existing data. Ask for a brain dump:

> **Brain dump time.** Paste tasks one per line, Todoist-style:
> - `#Project` to route (`#Personal`, `#Work`, `#Agendas`, `#"Someday Maybe"`)
> - `@label` (`@Waiting`, `@home`)
> - dates: `today`, `tomorrow`, `next mon`, `fri 9am`, `every monday`
> - `!!1`–`!!4` for priority (1 is highest)
> - `{deadline: YYYY-MM-DD}` for a hard deadline
> - plain text lands in the Inbox with no date
>
> Send `done` (or nothing) when you're empty.

Wait for the reply; `done`, an empty message or "skip" means no captures. Parse each line:
- `#Project` → project ID; an unknown project goes to the Inbox, and say so.
- `@label` → label names (Todoist creates missing ones).
- `!!N` → API priority `5 - N`: the API's 4 is the UI's `!!1`.
- `{deadline: ...}` → `deadlineDate`.
- Pass any remaining date phrase as `dueString` and let Todoist parse it; the rest is `content`.

Show the parsed list (`1. "Buy oil filter" → Personal, due tomorrow`) and ask: "Send these as-is, or fix anything first?" Apply edits ("change 2 to #Work", "drop 3"), and wait for approval before writing them all with one `Todoist:add-tasks`. Work in chunks of about 20 for long dumps. The new tasks come back through Get Clear like any other.

## Phase 2: Collect
Pull the raw material and report only counts.
1. Calendar, look-back and look-ahead windows.
2. Todoist: completed in the look-back window (`find-completed-tasks`); scheduled for the next 7 days including overdue (`find-tasks-by-date`, `startDate: "today"`, `daysCount: 7`, `overdueOption: "include-overdue"`); tasks due or with a deadline in the next 14 days; and the Inbox.
3. Apple Notes: `list_notes`, titles only. Note the ones that look like loose captures (short, casual, recent).
4. HEY: `hey_boxes` `get_imbox`, keeping `{id, topic_id, subject, sender, date, seen}` and no bodies; and `hey_contacts` `get_clearances` for the Screener.

Report: "Last week: N events, M tasks done. Next 7 days: N events, K tasks (J with deadlines). Inbox: P. Notes worth a look: Q. HEY: R Imbox threads, S in the Screener."

## Phase 3: Get clear
Empty the inboxes. Accept batched answers ("first 3 to Work, drop 5").
1. **Todoist Inbox:** for each task, move it to a project, schedule it, drop it, or leave it.
2. **Note captures:** ask which are next actions. Before adding a task from a note, search Todoist for the note's title or a distinctive phrase (tasks often link notes as `applenotes://` URLs). If a task exists, ask whether to leave it, update it, or add another.
3. **`Waiting` tasks:** does any need a nudge, or is it done?
4. **Overdue tasks:** reschedule, complete, or drop.

## Phase 4: Mail triage
Clear the Screener and surface the few Imbox threads that matter, judged against the tasks and calendar already loaded.

**Screener.** List pending senders with their address and message count. For up to about 5 senders you can't place from the address, read one thread and say in half a sentence what they want. Ask once for the whole list (`in: 1,3  out: 2,5`), and apply each with `update_clearance`. "Just clear it all" means `punt_clearances`; confirm that they mean everyone pending, to be re-screened on their next email.

**Important and urgent.** From the data already loaded (don't query again), watch for:
- people on `Waiting` tasks (the highest-value match), in Agendas tasks, and in 1:1s in the next 7 days;
- distinctive words from open tasks in the active projects, upcoming event titles, and tasks with a deadline in the next 14 days.

Flag an Imbox thread when it's **relevant** (a watched sender, or a subject that overlaps a watched topic or event), **urgent** (names a date in the next 7 days, states a deadline, or asks a direct question, and is unseen), or **stale but live** (unseen for over a week, from a real person, not a bundle). Treat a bundle as one low-priority item unless its sender is watched. Read the bodies of flagged threads only, at most about 10, and only to explain the flag. Every flag must trace to a specific task, event or phrase; if nothing qualifies, say so. A clean result is a real result.

Show at most about 10 rows, longest-waiting first:

```
| # | From | Subject | Why it surfaced |
|---|------|---------|-----------------|
| 1 | Sam  | Re: Q3 plan | @Waiting task "Ask Sam about Q3 plan", unanswered 9 days |
```

Ask, for all of them at once, whether each becomes a **task** (in an active project, with sender and subject in the content, after searching Todoist for an existing one: the same threads come up every week), an **event** (only when the mail names a concrete date and time), or nothing. If the user wants flagged threads marked seen, confirm the list, then mark them in one call using each row's `id`.

## Phase 5: Get current
Each active project should reflect reality and have a next action.
1. For each active project, show its open task count and last activity, and flag projects with nothing completed in 14 days as possibly stuck. Ask: "Still active? What's the next physical action?" With more than about 10 sub-areas, focus on the stuck-looking ones.
2. For each 1:1 in the coming week: "You have a 1:1 with X this week; anything from Agendas to bring up?"
3. List last week's 1:1s and named meetings, and ask whether anything needs capturing. Follow-ups for a person usually go to Agendas.

## Phase 6: Stale sweep
Find old undated tasks (`filter: "no date & created before: -14 days"`). In batches of 5–10, ask: keep, reschedule, drop, or move to Someday Maybe?

## Phase 7: Plan the week
1. Show the coming week by day, highlighting travel, deadlines, the partner's shifts, 1:1s, social events and holidays. Ask what needs prep, and capture prep tasks with due dates.
2. Show deadlines in the next 14 days. Ask whether any should move up or be broken down.
3. Ask: "If only three things happened this week, what would make it a win?" Capture them as P1 tasks.

## Phase 8: Write the review note
Create an Apple Note titled `Weekly Review — YYYY-MM-DD` with `add_note`. First read the most recent earlier `Weekly Review — *` note with `get_note_content`, and mirror its format if it has changed.

Apple Notes takes HTML, not Markdown, which shows as literal text. Escape `&`, `<` and `>`. Wins, lessons and open questions come from the user's own words, never from calendar data. Keep it short; a note that gets reread beats a long one.

```html
<div><b><span style="font-size: 24px">Weekly Review — [Date]</span></b></div>
<div><b><span style="font-size: 18px">Last week ([date range])</span></b></div>
<div><b>Completed (highlights)</b></div>
<ul><li>[the 5–10 most meaningful]</li></ul>
<div><b>Calendar highlights</b></div>
<ul><li>[1:1s, named meetings, travel, social events]</li></ul>
<div><b>Wins / lessons</b></div>
<ul><li>[the user's words]</li></ul>
<div><b><span style="font-size: 18px">This week ([date range])</span></b></div>
<div><b>Top 3 outcomes</b></div>
<ol><li></li><li></li><li></li></ol>
<div><b>Calendar (key items)</b></div>
<ul><li><b>Mon M/D</b> — [events]</li></ul>
<div><b>Deadlines &amp; watch-outs</b></div>
<ul><li>[deadlines in the next 2 weeks, travel, prep]</li></ul>
<div><b>Mail</b></div>
<ul><li>[threads that became tasks or events: sender and why; omit the section if none]</li></ul>
<div><b><span style="font-size: 18px">System hygiene</span></b></div>
<ul>
<li>Inbox processed: [count]</li>
<li>Notes processed: [count]</li>
<li>Stale tasks pruned: [count]</li>
<li>Stuck projects resolved: [count]</li>
<li>Screener: [N in, M out, K pending]</li>
</ul>
<div><b><span style="font-size: 18px">Open questions / someday-maybe seeds</span></b></div>
<ul><li>[things that surfaced without a home]</li></ul>
```

## Phase 9: Harness retro (pi only, optional)
Ask once: "Run the agent harness retro too?" If yes and you're in pi, follow `~/.pi/agent/prompts/retro.md` with 7 days, show its numbered proposals, and apply only the ones the user names. Outside pi, mention `/retro` and move on. Add `Harness retro: N proposals, M applied` to the note's System hygiene section.

## Phase 10: Wrap up
Say briefly what was cleaned up, where the note is, and the top 3 outcomes. No motivational close.

If a tool fails, tell the user and ask whether to retry, skip, or stop. Never archive Todoist projects; suggest candidates.

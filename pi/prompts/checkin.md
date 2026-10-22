---
description: Quiet check-in across HEY, Todoist, and Fantastical. Reports only what needs attention now, otherwise NO_REPLY
argument-hint: "[extra focus]"
---
Do a quick, read-only check-in on my mail, tasks, and calendar. ${@}

The point is to fight list numbness: surface the **few** things that need me in the next day, not the whole list. Silence is the best outcome.

## Gather (read-only)
Use the HEY, Todoist, and Fantastical MCP tools through codemode, batching the calls with `Promise.allSettled`. Only read; never move, label, complete, or reschedule anything. Headless runs (`pi/checkin/run.sh`) have no shell or write tools, and MCP write calls are blocked.
- **Calendar:** events from now through tomorrow evening.
- **Todoist:** tasks that are overdue, due today, or due tomorrow, and P1 tasks due in the next 7 days. The `limit` must be ≤ 100.
- **HEY:** Imbox postings since the last check-in (see state below), and anything bubbled up for today.

## Decide what needs attention
An item makes the cut only if at least one of these is true:
- I need to prepare for, leave for, or reply to it before tomorrow evening;
- it's overdue and still matters (not a stale chore I keep rescheduling);
- it's a reply I'm waiting on that just arrived, or mail from a real person that asks me something or has a date in it.

At most **3 items**, most urgent first. Skip anything already in the state file below, unless it changed or is now due within 2 hours.

## State
Read `~/.local/state/pi-checkin/reported.json` if it exists. It looks like `{"lastRun": "<ISO time>", "reported": {"<source>:<id>": "<ISO time>"}}`. Don't write any files. Instead, the very last line of your reply must be the new state, as one line of JSON after `STATE: `. Set `lastRun` to now, add the IDs you're reporting, and drop entries older than 7 days. The caller saves it and strips that line.

## Output
If nothing makes the cut, reply with exactly `NO_REPLY`, then the STATE line.

Otherwise, reply with up to 3 item lines, then the STATE line, and nothing else. If a source couldn't be read, add one short line saying so before the STATE line. Item lines look like:
`• <when> — <what> — <the one next action>`

For example: `• Today 15:00 — Dentist (Fantastical) — leave by 14:35`

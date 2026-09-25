---
name: weekly-review
description: Run a Getting Things Done (GTD) style weekly review across HEY mail, Fantastical (calendar), Todoist (tasks), and Apple Notes (reference/notes). Use this skill whenever the user asks for a "weekly review", "GTD review", "weekly planning", "weekly reset", or says things like "let's review the week", "plan my week", or "do my weekly". Also use when they want mail triaged as part of planning — clearing the HEY Screener, or surfacing email that looks important or urgent against their tasks and calendar. Trigger this even if GTD isn't mentioned by name — any request to look back at the past week and plan the next one across mail, calendar, tasks, and notes should use this skill.
---

# GTD Weekly Review

Walk the user through a GTD weekly review using Fantastical, Todoist, and Apple Notes. The output is **Todoist updates + a weekly review note in Apple Notes**.

## How this user's system actually works

Read this before calling any tools — it's where v1 of the skill made bad assumptions:

- **Solo Todoist account.** The user does not assign tasks to themselves. Filtering Todoist queries by `responsibleUser: <userID>` returns zero results. Always use `responsibleUserFiltering: "unassignedOrMe"` (the default) or omit assignment filters entirely.
- **Due dates AND deadlines.** Todoist tasks have two date fields: `dueDate` ("I'll work on it on this date") and `deadlineDate` ("it must be done by this date"). The user uses both. Surface deadlines separately from due dates when reviewing the week ahead.
- **Project structure.** The user's real project layout is:
  - **Personal** — life tasks, errands, gifts, health, etc.
  - **Work** — Chainguard tasks
  - **Agendas** — questions/topics queued for specific people (1:1 fodder)
  - **Someday Maybe** — the parking lot for items they're not committing to but don't want to drop
  - **Checklists** — contains the weekly-review checklist task with subtasks like "Look at last week calendar", "Empty your head", "Look at Projects list", etc. Use this as a sanity check for what the review should cover.
  - Plus a personal **bug tracker** for a TUI app the user is building (entries like `[Task Creation View]`, `[Picker Item]`). This is **not** GTD inbox material — exclude it from life-task summaries unless the user asks.
  - Plus the system **Inbox**.
- **Waiting label.** The `Waiting` label means the user is blocked on someone else doing something. During Get Clear, surface these and ask if any need a nudge.
- **Someday/Maybe = the "Someday Maybe" project.** When the user says "move to someday" during the stale sweep, move the task to that project (don't try to use a label).
- **Multi-context life.** The user has Chainguard work (engineering), personal events, side projects, and visibility into their partner's calendars. **The QGenda calendar is the partner's clinical work schedule** (STICU, Trauma, transplant nights) — these are *not* the user's shifts. When summarizing, group QGenda events under "Partner's schedule" and use them for context/prep (e.g., "partner on nights Wed–Fri"), never as the user's own commitments. Don't try to flatten everything into one bucket.
- **All calendars are in scope** (work, partner, holidays, travel) — the user prefers to see everything. Filter *displayed noise* differently for look-back vs look-ahead:
  - **Look-back summary:** skip recurring standups, all-hands, holidays, birthdays, recurring ops meetings.
  - **Look-ahead summary:** still skip standups and all-hands, but **keep holidays, birthdays, and travel visible** — the user wants these for prep context.
  Always keep the raw data available in case the user asks about something specific.
- **Apple Notes folder for reviews:** if the user hasn't specified one yet, ask once and remember in the note title. Default behavior: just create the note in the default location.
- **HEY is the user's email.** It is exposed through **two deliberately separate MCP servers**, and the split is a safety boundary, not an accident:
  - **`hey`** — read-only, domains `threads,search,boxes`. Reading mail, searching, listing boxes. It has no reply, compose, move, or trash action at all.
  - **`hey-triage`** — writable, domain `contacts` only. The Screener and contact records.

  **The user does not want Claude replying to email.** In Desktop chat that is enforced by the tools simply not existing. In the Code tab, Bash exposes the whole `hey` CLI including `hey reply` and `hey compose` — so there it is a rule, not a wall. Never send, reply to, or forward mail. Draft proposed wording in chat if asked; do not put it in HEY.
- **HEY's boxes do most of the noise filtering already.** Newsletters land in the **Feed** and receipts in the **Paper Trail**, so the **Imbox** is already the signal. Scan the Imbox. Don't drag through Feed or Paper Trail unless the user asks.
- **HEY calendar is unused** — Fantastical is the calendar. The `calendar` and `todos` HEY domains are deliberately not exposed. Never suggest creating a HEY todo or event; todos go to Todoist, events to Fantastical.

## Tool quirks to remember

- **`Fantastical:queryCalendarItems`** is officially substring-search by name, but passing only `when` (no `query`) returns everything in the window in practice. Use that. Don't waste tokens on multiple keyword queries.
- **Fantastical output is verbose.** Each event has `id`, `calendarId`, location URLs. Extract only `title`, `startDate`, `endDate`, and (optionally) `calendarId` for grouping. Drop the rest before reasoning over the list.
- **Todoist `find-completed-tasks`** without a `responsibleUser` parameter works correctly for solo users. With it, it returns nothing.
- **`Todoist:find-tasks`** accepts raw filter strings like `"no date"`, `"overdue"`, `"7 days"`, `"##ProjectName"` — useful for slicing the task list without iterating projects.
- **HEY tools are gateway-style.** Call as `{"action": "...", "params": {...}}`. `{"action": "describe", "params": {"action": "NAME"}}` returns an action's full parameter schema — use it rather than guessing parameter names.
- **"Clearance" means Screener decision.** `hey_contacts:get_clearances` is the pending Screener queue; `get_my_clearances` is senders already decided. `update_clearance` screens one sender in or out.
- **Two HEY actions are destructive and all-or-nothing.** Both need explicit confirmation every time — never as part of a batch:
  - `punt_clearances` clears the **entire** Screener at once.
  - `bulk_update_clearances` screens senders **out** only (it has no "in" mode).
- **Per-email seen is CLI-only.** The MCP `boxes` domain offers only whole-box `mark_box_seen`, which is not exposed here on purpose. To mark individual threads seen, use Bash: `hey seen <box-item-id>...` (IDs come from `hey box view`; `hey unseen` reverses it). This means **per-email seen works in the Code tab and is impossible in Desktop chat** — say so rather than falling back to the whole-box action.
- **Two kinds of HEY ID.** A row from a box listing has both an `id` (the box item — use with `seen`/`unseen`/`move`) and a `topic_id` (the thread — use for reading). Don't mix them up.
- **Bundles have no `topic_id`.** A row with `kind: "bundle"` groups one sender's unseen threads; list them with `hey bundle view <id>`.

## Time window

- **Look-back:** past 7 days
- **Look-ahead:** next 7 days

Compute these from today's date. Don't ask the user.

## Workflow

Run phases in order. Be conversational during processing phases; be terse during data-gathering. Skip nothing without explicit user say-so.

### Phase 0: Setup (silent)

1. **Connectivity precheck.** Before anything else, verify all required connectors are available: Fantastical, Todoist, Apple Notes, and both HEY servers (`hey` and `hey-triage`). HEY is degradable — if only the HEY servers are missing, say so and offer to run the review without Phase 2.5 rather than aborting. If any are missing or `tool_search` doesn't surface them, stop immediately and tell the user which connector is missing — don't attempt a degraded review unless they explicitly ask. Once all three are confirmed available, do a single sanity call to each (e.g., `Todoist:user-info`, `Fantastical:queryCalendars`, `Read and Write Apple Notes:list_notes` with a small limit) to catch auth failures up front rather than mid-phase. If a sanity call fails, ask the user to reconnect that specific connector and pause.
2. Get today's date. Compute the past-7 and next-7 windows.
3. Call `Todoist:user-info` once — useful context, but **do not** use the user ID to filter tasks. (If already done in step 1's sanity call, reuse the result.)
4. Call `Todoist:find-projects` once and cache the project list with their IDs. Map by name:
   - **Inbox** — for unprocessed captures
   - **Personal**, **Work**, **Agendas** — the active life/work projects
   - **Someday Maybe** — destination for parked items
   - **Checklists** — reference for the weekly-review checklist
   - The bug-tracker project — skip in summaries (excluded by default)
   If a name doesn't match exactly (case differences, emoji prefixes), use the closest match and confirm once with the user. Cache the name→ID mapping for the session.
5. Tell the user: "Walking you through a GTD weekly review — capture, collect, get clear, get current, stale sweep, plan the week. ~10 minutes." Then proceed.

### Phase 0.5: Capture (brain dump)

Goal: get everything out of the user's head and into Todoist before touching any existing data. This runs **before** Collect so the new captures flow through Get Clear like any other inbox item.

1. Prompt the user with exactly this (or close to it):

   > **Brain dump time.** Paste tasks one per line, Todoist-style. You can use:
   > - `#Project` to route (e.g. `#Personal`, `#Work`, `#Agendas`, `#"Someday Maybe"`)
   > - `@label` for labels (e.g. `@Waiting`, `@home`)
   > - Natural language dates: `today`, `tomorrow`, `next mon`, `fri 9am`, `every monday`
   > - `!!1`–`!!4` for priority (1 = highest)
   > - `{deadline: YYYY-MM-DD}` for hard deadlines (separate from due date)
   > - Plain text only — no project/label/date means it lands in **Inbox** with no date
   >
   > Send `done` (or just hit send with nothing) when you're empty.

2. **Wait for the user's reply.** Do not proceed until they respond. If they send `done`, an empty message, or "skip", move on to Phase 1 with zero captures.

3. **Parse each line** the user sends:
   - Extract `#Project` → resolve against the cached project map from Phase 0. If the project name doesn't match, default to Inbox and note it for the user at the end of this phase ("couldn't find project 'Foo' — sent to Inbox").
   - Extract `@labels` → pass through as label names; Todoist will create them if missing.
   - Extract `!!N` → map to Todoist priority (Todoist's API uses 4 = highest, 1 = lowest, inverse of the UI; the user is typing UI-style, so `!!1` → API priority 4, `!!4` → API priority 1).
   - Extract `{deadline: ...}` → set `deadlineDate`.
   - Everything else after stripping the above goes to the task `content`. Pass any remaining natural-language date phrasing through as the `dueString` so Todoist parses it server-side — don't try to parse dates yourself.
   - If nothing matches a project, target the **Inbox**.

4. **Confirm before writing.** Show the parsed result back as a compact list:
   ```
   1. "Buy oil filter" → Personal, due tomorrow
   2. "Ask Sam about Q3 plan" → Agendas, @Waiting
   3. "Fix bug in picker" → Inbox (no project matched 'bugs')
   ```
   Ask: "Send these as-is, or fix anything first?" Accept edits like "change 2 to #Work" or "drop 3" before writing.

5. **Write in one batched call** via `Todoist:add-tasks` with the full array. Report the count: "Captured N tasks. Now starting Collect."

6. **The just-captured items will reappear in Phase 1's Inbox/project pulls** — that's intentional. They flow through Get Clear with the rest. Don't try to "skip" them in Phase 2.

If the user pastes a giant wall (50+ items), don't try to parse it all in one shot — process in chunks of ~20, confirm each chunk, then send.

### Phase 1: Collect

Pull the raw material. Be terse — just confirm counts.

1. **Calendar look-back.** `Fantastical:queryCalendarItems` with `when: "<date> to <date>"`, no query string. Strip to `{title, startDate, endDate, calendarId}`.
2. **Calendar look-ahead.** Same call for the next 7 days.
3. **Todoist completed last week.** `Todoist:find-completed-tasks` with `since` and `until` set to the look-back window. **No `responsibleUser` parameter.**
4. **Todoist scheduled this week.** `Todoist:find-tasks-by-date` with `startDate: "today"`, `daysCount: 7`, `overdueOption: "include-overdue"`. Default filtering is fine.
5. **Todoist deadlines.** `Todoist:find-tasks` with `filter: "due before: +14 days"` to surface tasks with looming deadlines, plus a separate scan of items with `deadlineDate` populated.
6. **Todoist Inbox.** `Todoist:find-tasks` with `projectId: <inbox-id>` — these are unprocessed captures.
7. **Apple Notes recent.** `Read and Write Apple Notes:list_notes`. Eyeball for notes that look like loose captures (short titles, casual phrasing, recent modification). Don't fetch every note's content — just titles.
8. **HEY Imbox.** `hey:hey_boxes` with `get_imbox`. Strip each row to `{id, topic_id, subject, sender, date, seen}`. Don't fetch thread bodies yet — Phase 2.5 fetches only the ones worth reading.
9. **HEY Screener.** `hey-triage:hey_contacts` with `get_clearances` — just the pending count and the waiting senders.

Report: "Last week: N events, M completed tasks. Next 7 days: N events, K scheduled tasks (J with deadlines). Inbox: P unprocessed. Apple Notes: Q recent notes worth a look. HEY: R Imbox threads, S waiting in the Screener. Starting Get Clear."

### Phase 2: Get Clear

Goal: empty the inboxes. Process loose captures into actions, references, or trash.

1. **Todoist Inbox.** Show the user the inbox tasks (titles only). Ask: "For each: move to Personal/Work/Agendas/Someday Maybe, schedule, drop, or leave?" Accept batched answers ("first 3 to Work, last 2 to Someday Maybe, drop #5"). Apply with `Todoist:update-tasks` (to change `projectId`) or `Todoist:delete-object`.
2. **Apple Notes recent captures.** List the recent notes that look unprocessed. Ask: "Anything here that's a next action I should put in Todoist?" **Before adding any task derived from a note**, check whether a Todoist task already references that note — use `Todoist:search` or `Todoist:find-tasks` with `searchText` matching the note title or a distinctive phrase from it (note links in tasks often appear as `applenotes://...` URLs or as Markdown links pointing at the note). If a match exists, surface it to the user ("there's already a task for this — leave it, update it, or add another anyway?") rather than blindly adding a duplicate. Only after the duplicate check, add via `Todoist:add-tasks` to the right project. **Don't delete notes** — that's for the user.
3. **Stalled "Waiting" items.** Surface any Todoist tasks with the `Waiting` label (these are things the user is blocked on someone else for). Ask: "Any of these need a nudge, or to be closed out because they're done?"
4. **Overdue tasks** (if any from Phase 1.4). One-line summary, ask: "Reschedule, complete, or drop?" Batch the operations.

Skip items in the bug-tracker project unless the user explicitly asks about it.

### Phase 2.5: Mail Triage (HEY)

Goal: clear the Screener, and surface the handful of Imbox threads that are actually important or urgent — judged against the tasks and calendar already loaded in Phase 1. **This phase never sends mail.**

Run it after Get Clear so the Todoist and calendar picture is already in hand; the relevance pass depends on it.

#### A. Screener

1. Show the pending senders from Phase 1.9 as a compact list: sender name, address, and how many messages are waiting. If a sender is unrecognizable from the address alone, read one thread via `hey:hey_search` or `hey_threads:get_topic` to say what they want in a half-sentence. Cap this at ~5 lookups — for the rest, show the raw sender and let the user decide.
2. Ask once, for the whole list: "Screen in, screen out, or leave pending? (e.g. `in: 1,3  out: 2,5`)"
3. Apply with `hey-triage:hey_contacts` `update_clearance` per sender.
4. **Never call `punt_clearances`** — it clears the entire Screener in one shot. If the user says "just clear it all", confirm explicitly that they mean *punt everyone pending, to be re-examined on their next email*, and only then call it.
5. **Never use `bulk_update_clearances` for approvals** — it only screens senders *out*. Screening several people in means several `update_clearance` calls.

#### B. Important & urgent scan

Build the match set from data already pulled in Phase 1 — do not re-query:

- **People to watch:** names and addresses appearing in `Waiting`-labeled Todoist tasks (the user is blocked on these people — mail from them is the highest-value match there is), in **Agendas** tasks, and as attendees of 1:1s in the next 7 days.
- **Topics to watch:** distinctive words from open task content in **Personal**, **Work**, and **Agendas**; titles of upcoming calendar events; and any task with a `deadlineDate` inside 14 days.

Then pass over the Phase 1.8 Imbox rows and flag a thread when:

- **Relevant** — the sender is someone on the watch list, or the subject overlaps a watched topic or an upcoming event.
- **Urgent** — the subject or preview names a date inside the next 7 days, states a deadline, or asks a direct question and is still unseen.
- **Stale but live** — unseen for more than a week and from a real person (not a bundle).

Rules for this pass:

- **Only fetch bodies for candidates.** Use `hey:hey_threads` `get_topic` / `get_topic_entries` on flagged threads only, capped at ~10. A subject-line match is enough to flag; the body is only to explain *why*.
- **Scan the Imbox only.** Feed and Paper Trail are noise by design.
- **A `kind: "bundle"` row is one sender's grouped mail** — treat it as a single low-priority item unless that sender is on the watch list.
- **Don't invent urgency.** Every flag must be traceable to a specific task, event, or a phrase in the mail itself. If nothing qualifies, say "nothing in the Imbox looks important this week" and move on — a clean result is a real result.

Present as a short ranked table, longest-waiting first, and never more than ~10 rows:

```
| # | From | Subject | Why it surfaced |
|---|------|---------|-----------------|
| 1 | Sam  | Re: Q3 plan | @Waiting task "Ask Sam about Q3 plan" — unanswered 9 days |
| 2 | Dr. Ruiz | Appt confirmation | Names Thu 3/14, no calendar event exists |
```

#### C. Turn it into actions

For each flagged thread, ask what the user wants — batched, not one at a time:

- **Task** → `Todoist:add-tasks`, routed like any other capture (Personal / Work / Agendas). Put the sender and subject in the task content so it's findable later.
- **Event** → `Fantastical:createCalendarItem`. Only when the mail names a concrete date and time; otherwise make it a task.
- **Nothing** → leave it.

Before adding, **check for duplicates** the same way Phase 2 does for notes — `Todoist:search` on the sender or subject. A weekly review run every week will keep re-flagging the same unanswered thread; don't create the task twice.

**Nothing in this phase replies.** If the user's answer is "I need to respond to that", the output is a Todoist task, not an email.

#### D. Marking seen (Code tab only)

If the user wants flagged threads marked seen, that is `hey seen <box-item-id>...` via Bash, using the `id` field (not `topic_id`) from the Phase 1.8 rows. Confirm the list first, then one batched call.

In Desktop chat there is no Bash and no per-email seen action — say that plainly and skip it. Do not substitute `mark_box_seen`; it marks the whole Imbox seen and is not what the user asked for.

### Phase 3: Get Current

Goal: project lists reflect reality. Each active project has a clear next action.

1. Walk through **Personal**, **Work**, and **Agendas** in turn (skip Inbox, Checklists, Someday Maybe, bug-tracker, archived). For each:
   - Show project name + count of open tasks + last activity (most recent completion or addition).
   - Flag projects with no completed tasks in the past 14 days as potentially stuck.
   - Ask: "Still active? What's the next physical action?" — capture via `Todoist:add-tasks`.
2. **Agendas-specific prompt.** Agendas exists for a reason — questions and topics queued for specific people. Surface upcoming 1:1s from the calendar week and cross-reference: "You have a 1:1 with X this week — anything from Agendas to bring up?"
3. Surface 1:1s and named meetings from last week's calendar (filter out standups, all-hands). Show as a short list. Ask: "Anything to capture from these?" — let the user scan, don't ask one-by-one. Capture follow-ups via `Todoist:add-tasks` into the right project (often **Agendas** for "next time I talk to X" items, or **Work**/**Personal** for direct actions).
4. If the user has more than ~10 active sub-areas across Personal/Work, prioritize stuck-looking ones. Don't drag through everything.

### Phase 4: Stale Task Sweep

Goal: prune dead weight.

1. `Todoist:find-tasks` with `filter: "no date & created before: -14 days"` (or equivalent) to find old, undated tasks. Skip the bug-tracker project.
2. Show in batches of 5–10. For each batch, ask: "Keep, reschedule, drop, or move to Someday?" — accept comma-separated answers.
3. **"Move to Someday"** = move the task to the **Someday Maybe** project via `Todoist:update-tasks` with the cached project ID. Don't ask the user how to model this — it's already a project.
4. Apply changes in batched tool calls.

### Phase 5: Plan the Week

Goal: a concrete picture of the next 7 days.

1. Show upcoming calendar week grouped by day. Filter recurring noise (standups, all-hands) but **keep holidays, birthdays, travel, social events visible** — the user wants those for context. Highlight: travel, deadlines, clinical shifts, 1:1s, social events, holidays. Ask: "Anything you need to prep for?" — capture prep tasks via `Todoist:add-tasks` with appropriate due dates and into the right project (Personal vs Work).
2. Show tasks with deadlines in the next 14 days. Ask: "Any of these need to be moved up or broken down?"
3. **Top 3 outcomes.** Ask directly: "If only three things happened this week, what would make it a win?" Capture as P1 tasks in the appropriate project (Personal or Work).

### Phase 6: Write the Review Note

Create one Apple Note titled `Weekly Review — YYYY-MM-DD` (today's date).

**Apple Notes formatting is HTML, not Markdown.** Apple Notes renders `<div>`, `<b>`, `<ul>`/`<li>`, `<ol>`/`<li>`, and `<span style="font-size: Npx">` natively. Markdown (`#`, `**`, `-`) is shown as **literal text**, not formatted — never use it. To match the user's existing review notes, use:

- **Note title (top, 24px):** `<div><b><span style="font-size: 24px">Weekly Review — YYYY-MM-DD</span></b></div>`
- **Section headings (18px):** `<div><b><span style="font-size: 18px">Last week (Mon DD – Mon DD)</span></b></div>`
- **Subsection labels (bold, default size):** `<div><b>Completed (highlights)</b></div>`
- **Bulleted lists:** `<ul><li>item</li><li>item</li></ul>`
- **Numbered lists:** `<ol><li>item</li><li>item</li></ol>`
- **HTML-escape** ampersands (`&amp;`), `<`, and `>` inside list items.

Before writing, if any prior `Weekly Review — *` note exists, call `Read and Write Apple Notes:get_note_content` on the most recent one to verify the user's current formatting conventions and mirror them — the user's preferences may evolve, and copying their working format avoids re-formatting work.

Template (HTML):

```html
<div><b><span style="font-size: 24px">Weekly Review — [Date]</span></b></div>
<div><b><span style="font-size: 18px">Last week ([date range])</span></b></div>
<div><b>Completed (highlights)</b></div>
<ul>
<li>[5–10 most meaningful items from completed tasks — not all 20+]</li>
</ul>
<div><b>Calendar highlights</b></div>
<ul>
<li>[1:1s, named meetings, travel, social events — skip standups/all-hands]</li>
</ul>
<div><b>Wins / lessons</b></div>
<ul>
<li>[In the user's own words from the review]</li>
</ul>
<div><b><span style="font-size: 18px">This week ([date range])</span></b></div>
<div><b>Top 3 outcomes</b></div>
<ol>
<li></li>
<li></li>
<li></li>
</ol>
<div><b>Calendar (key items)</b></div>
<ul>
<li><b>Mon M/D</b> — [events]</li>
</ul>
<div><b>Deadlines &amp; watch-outs</b></div>
<ul>
<li>[Tasks with deadlineDate in the next 2 weeks, travel, prep needed]</li>
</ul>
<div><b>Mail</b></div>
<ul>
<li>[Threads that turned into tasks or events — sender + one-line why. Omit this section entirely if nothing surfaced.]</li>
</ul>
<div><b><span style="font-size: 18px">System hygiene</span></b></div>
<ul>
<li>Inbox processed: [count]</li>
<li>Notes processed: [count]</li>
<li>Stale tasks pruned: [count]</li>
<li>Stuck projects resolved: [count]</li>
<li>Screener: [N screened in, M out, K left pending]</li>
</ul>
<div><b><span style="font-size: 18px">Open questions / someday-maybe seeds</span></b></div>
<ul>
<li>[Things that surfaced without a home]</li>
</ul>
```

Use `Read and Write Apple Notes:add_note`. Keep it tight — a long note nobody re-reads is worse than a short one that gets reread.

### Phase 7: Wrap

Briefly: what was cleaned up, where the note lives, top 3 outcomes. Stop. No motivational close.

## Behavior rules

- **Batch tool calls** when processing multiple items. Todoist `add-tasks`, `complete-tasks`, `update-tasks`, `reschedule-tasks` all accept arrays — use them.
- **Never delete Apple Notes** on the user's behalf. Only the user does that.
- **Never auto-archive Todoist projects.** Surface candidates and let the user decide.
- **If a tool fails** (auth, rate limit), tell the user and ask whether to retry, skip, or abort. Don't move on silently.
- **Honor skips.** If the user says "skip Phase 4," do it, but tell them what they're skipping.
- **Don't fabricate.** Wins, lessons, and open questions come from the user's own words during the review. Don't invent them from calendar data. The same applies to mail: every flagged thread must trace to a real task, event, or phrase.
- **Never send, reply to, or forward email.** Not through MCP, not through the `hey` CLI in Bash. "I should reply to this" becomes a Todoist task.
- **Confirm the two destructive HEY actions every time** — `punt_clearances` (clears the whole Screener) and `mark_box_seen` (marks a whole box seen). Never batch them with anything else.
- **HEY is read-mostly.** The only writes this skill makes to HEY are Screener decisions in Phase 2.5A, and `hey seen` on threads the user named.

## When NOT to use this skill

- Quick task adds — use Todoist directly.
- Daily planning — different cadence.
- Project-specific planning sessions — different workflow.
- The user just wants a calendar summary — pull from Fantastical directly without the full review.
- The user just wants to check mail or clear the Screener — use the HEY tools directly. A Screener sweep is not a weekly review.

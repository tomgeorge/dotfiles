# Ideas

Not committed to yet; promote to TODO.md once one is worth doing.

## Crew

- **Give the crew panel an outer border.** Only its sections are boxed, so the
  panel's edge and its title (the header) are hard to pick out from the session
  underneath.
- **Style the crew panel better.** Overall look: colour, spacing, emphasis.
- **Show that crew work is in progress.** Starting a big crew and running
  `/crew-clean` give no notification while they work (worktree setup, branch
  and worktree removal), so it looks like nothing is happening.
- **Multicrew support.** Today it's one crew per session; parallel crews need
  separate sessions, and bare `/crew-resume`, `/crew-clean`, and the panel fall
  back to the newest ledger crew, which can be one still active elsewhere
  (resume would mark its running tasks interrupted). At minimum, skip `active`
  crews in those fallbacks; ideally, run and switch between crews in one session.
  The panel side is ready: `crewSource(getCrew, deps)` draws one crew, so
  showing several is one source per crew (switched, or merged with prefixed ids).
- **Suspend the crew when it goes over budget, and say by how much.** Today the
  budget only refuses new dispatches: running workers finish, the planner is
  told once, and the crew stays active, often ending above the budget. Suspend
  it instead, and report the overspend (e.g. "$11.40 of $10.00, $1.40 over").
- **Raise the budget and resume a crew that stopped on budget.** Today that means
  `/crew-stop`, hand-editing `config.budgetUsd` and `budgetReported` in the
  ledger, then `/crew-resume`. Add a command such as `/crew-budget <usd>`, or a
  budget prompt in `/crew-resume`, that resumes where the crew left off.
- **Make crews durable.** The ledger and transcripts survive restarts, but
  workers are child processes of the session: closing Pi kills them and marks
  them `interrupted`, and their in-flight work is lost. Crews should keep running,
  or pick up cleanly, across Pi restarts and crashes.

## Pi UI

- **One panel for every source (`/runs`).** After
  `.agent/plans/unified-agent-panel.md`, list crew tasks, subagent jobs,
  watches, and loops together, each with its own tabs and actions. Also covers
  the crew README's "crew workers in `/subagents`" follow-up. Pi loads each
  extension with `moduleCache: false`, so a module-level registry won't be
  shared; extensions would announce their sources over `pi.events` in answer to
  a discover event (so load order doesn't matter), and one extension owns the
  command. Only worth it once several kinds of work often run at once.
- **Draw the widgets from the panel sources.** The strips below the editor
  (subagent, watch, crew) still render their own rows; they could reuse each
  source's items, glyphs, and columns, as the panel does.
- **Panel: mark several items and act on all of them** (mini.pick's
  `choose_marked`), e.g. cancel three workers or stop every watch.
- **Panel: refine** (mini.pick): make the current matches the new item set,
  then filter within them.
- **Panel: query syntax** in the filter: `'exact`, `^prefix`, `suffix$`, as
  telescope and fzf do. Today every token is a fuzzy match.
- **Panel: user key maps.** Actions are named, so a settings file could remap
  their keys without touching a source (telescope's `actions.*:replace`).
- **Panel: resume** (mini.pick's `resume()`): reopen the last panel with its
  selection, tab, filter, and scroll as they were.
- **Doom-style leader key, from [doompi](https://github.com/AgiFlow/doompi).**
  `SPC` on an empty prompt (and `ctrl+space` anywhere) opens a which-key map of
  commands: `SPC c l` lists crews, `SPC c s` crew status, `SPC a l` subagents,
  `SPC w l` watches. Keys narrow the map step by step; backspace goes up a
  level; esc or an unknown key cancels. Each extension contributes bindings to
  one registry instead of claiming its own `ctrl+shift+*` chord. A binding is a
  path of one-character segments with labels, plus a slash command or a named
  action. doompi's editor (`packages/foundations/doompi-ui/src/tui/doomEditor.ts`)
  and registry (`src/services/leaderRegistry/`) are the model to copy. Open
  questions:
  - **Where the leader lives.** vi-mode owns the editor through
    `setEditorComponent`, and Pi allows only one, so the leader goes in vi-mode
    or a shared editor.
  - **Space in NORMAL mode.** Should `SPC` be the leader there too, and does
    that clash with any vi binding?
  - **How bindings get registered.** Contributions cross extensions, so they
    go over `pi.events` like the `/runs` registry.
  - **Listing crews.** `SPC c l` needs a picker over the repo's ledger; today
    `/crew-status` opens a single crew.

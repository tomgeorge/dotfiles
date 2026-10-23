# One panel for crew tasks, subagent jobs, and watches

This ExecPlan is a living document. Keep the Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective sections up to date as the work proceeds. It follows `pi/prompts/execplan.md`. Start a session with `/execplan continue .agent/plans/unified-agent-panel.md`.

## Purpose

Three Pi extensions in this repo each show background work in a full-screen panel:
- the crew panel (`ctrl+shift+c`, `/crew-status`);
- the subagents popup (`ctrl+shift+s`, `/subagents`);
- the watches popup (`ctrl+shift+w`, `/watches`), which lists watches and loops.

Each draws its own list, details pane, keys, and footer from its own record type, and they have drifted apart. The crew panel has tabs, a filter, help, zoom, a live transcript, and a confirmation before cancelling. The other two have none of these.

After this change, all three are drawn by one shared **presenter**. The presenter takes a **source** (a plain description of a list of items, how to show each one, and what can be done to it) and handles everything on screen: layout, keys, filtering, scrolling, help. It knows nothing about crews, subagents, or watches. Each extension supplies a source that converts its own records into that shape and carries out its actions. The design borrows from two Neovim pickers, telescope.nvim and mini.pick; see "Prior art" under Context.

What you can see afterwards:
- `/subagents` and `/watches` look and behave like the crew panel: the same layout, keys, type-to-filter, `?` help (generated from each source's actions), `ctrl+o` zoom, numbered tabs, and actions that ask for `y` before doing anything destructive.
- The crew panel looks and behaves as it does today.
- A new kind of background work gets a panel by writing a source, with no presenter changes. That's the groundwork for two ideas in `IDEAS.md` that this plan doesn't build: running several crews at once ("Multicrew support"), and the crew README's follow-up of showing crew workers in `/subagents`.

## Context

### Where things live

This is the dotfiles repository at `~/git/dotfiles`.
- **Loading.** Pi (a coding-agent CLI) loads extensions from `~/.pi/agent/extensions/<name>/index.ts`. `link.sh` symlinks each extension directory separately, for example `pi/extensions/crew` to `~/.pi/agent/extensions/crew`. A directory under `pi/extensions/` without a line in `link.sh` is never loaded as an extension.
- **Language and tests.** Extensions are TypeScript, loaded by Pi through jiti with no build step. Tests use `node:test` under Node 24 type stripping; check them with `rg '^ℹ (tests|pass|fail)'`, not TAP's `# pass`.
- **API types.** The Pi extension API types are in `/nix/store/8pm5imbp5660gq107j5aj0qdxgmnxy6s-pi-coding-agent-1.0.2/lib/node_modules/pi-monorepo/dist/core/extensions/types.d.ts`.
- **Shell.** `sed` here is GNU sed.

### Terms

- **Item**: one row in a panel: a crew task, a subagent job, a watch, or a loop. The four record types behind them are:
  - `TaskRecord` in `pi/extensions/crew/state.ts`: one worker in its own git worktree;
  - `JobRecord` in `pi/extensions/subagent/jobs.ts`: one read-only child Pi process;
  - `WatchRecord` in `pi/extensions/watch/panel.ts`: a shell check on an interval (a **watch**) or a prompt sent to the model on an interval while Pi is idle (a **loop**).
- **Source**: the per-extension object that lists items and describes how to show them and act on them. Defined in Milestone 2.
- **View**: one tab of the details pane, such as Overview, Diff, or Log. A source declares its views; each one turns an item into **content**, plain data the presenter knows how to draw.
- **Presenter**: the shared rendering and key handling, in a new directory, `pi/extensions/run-panel/`.
- **Style**: an interface every panel already receives with colours, width measurement, truncation, and wrapping. It's injected so tests can render without Pi; production builds it from Pi's theme and `@earendil-works/pi-tui`.
- **Widget**: the strip below Pi's editor that subagent and watch show while something runs, and crew shows while a crew is active. Out of scope here; see the Decision Log.

### The crew panel today

`pi/extensions/crew/panel.ts` (797 lines) is a set of pure functions:
- `initialPanel(crew)` creates the interaction state (`PanelState`).
- `panelInput(state, tasks, input, opts)` applies one key, mutates the state, and returns a `PanelAction`: `none`, `close`, `cancel`, `open` (copy the worktree path), or `export`.
- `panelLines(crew, state, now, width, height, style, deps)` returns the lines to draw and the details pane's page height.
- `deps` loads content on demand. `deps.diff(task)` uses a `DiffCache` class, defined in the same file, which runs `git diff`. `deps.transcript(task)` uses `pi/extensions/crew/transcript.ts`, which reads the live event stream or the worker's session file.

Layout:
- a three-line header (goal, branch, budget bar, models);
- a task list whose columns drop at narrow widths;
- a details pane with six tabs: Overview, Spec, Handoff, Checks, Diff, Live.

Panes sit side by side from 100 columns and stack below that.

Behaviour:
- a fuzzy filter (`filterTasks`);
- a "quiet" warning on tasks that have gone silent;
- an expandable Checks list with a cursor;
- a Live tab that follows new output until you scroll up;
- zoom, help, a confirmation before cancelling, and a one-line flash message in the footer.

`pi/extensions/crew/index.ts`, `openPanel()` (around lines 585-702), wires the panel to Pi:
- It maps raw key data to `PanelInput` through `PANEL_KEYS` and `panelEvent()`, and builds the Style in `panelStyle()`.
- It shows the in-memory crew when that's the one on screen, and otherwise reloads the ledger file every 2 seconds.
- It performs the actions: abort a worker's controller, copy a path to the clipboard, run `pi --export`. It reports results through `state.flash`.

Tests: `pi/extensions/crew/panel.test.ts` covers the pure functions. `pi/extensions/crew/index.test.ts`, from around line 418, drives the panel through a fake Pi (`pi/extensions/test-support/fake-pi.ts`).

### The subagents popup today

`pi/extensions/subagent/panel.ts` (328 lines) has the same structure under other names: `initialPopup`, `popupKey`, `popupLines`, and `PopupState`. Its details pane has a fixed header (cwd, git branch, tools, spend, calls, and the task cut to 3 lines) and one of three views:
- activity: one line per tool call;
- result: markdown;
- task: markdown.

`a` switches between activity and result, `t` shows the task, `ctrl+o` expands the task, and `x` cancels with no confirmation. The same file also draws the widget (`widgetLines`).

`pi/extensions/subagent/jobs.ts` holds `JobStore`, a session-only in-memory store with `list()`, `get()`, and `subscribe(listener)`.

`pi/extensions/subagent/index.ts`, `openPopup()` (around lines 111-148), wires the popup. Its `makeStyle()` adds `markdown(text, width)`, rendered by `glow` when installed (`pi/extensions/subagent/markdown.ts`), else by Pi's `Markdown` component.

### The watches popup today

`pi/extensions/watch/panel.ts` mixes three things:
- **`WatchStore`**: the session record of every watch, with an event log per watch. Repeated identical checks collapse into one log entry with a `×N` count, and at most 50 ended watches are kept.
- **The widget**: `widgetLines`.
- **The popup**: `initialPopup`, `popupKey`, `popupLines`.

The popup's details pane has a fixed header and one of two views. The header holds the kind and mode, cwd, interval and time left, counts, status, and the command or prompt cut to 3 lines. The views are:
- activity: the timestamped event log, opened at the end;
- output: the last check's stdout and stderr, or a loop's prompt.

`a` toggles between them and `x` stops the watch with no confirmation. The file's header comment says the shared bits were "copied rather than imported" because each extension is linked on its own; this plan removes that reason (see Surprises).

List glyphs: `◷` means waiting for the next check, a spinner means checking, and `●` means a loop is due when Pi goes idle. Ended watches show `✓` (met), `✗` (error), or `⊘` (timeout or stopped).

`pi/extensions/watch/index.ts`, `openPopup()` (around lines 116-151), wires it. Stop goes through `registry.stop(id)`, and the guard `registry.get(id) === watch` matters because watch ids are reused once a watch ends.

### Prior art: telescope.nvim and mini.pick

Both split a picker into a data part, supplied by whoever writes the picker, and a generic UI.

- **telescope.nvim.** A picker is a **finder** (produces items), a **sorter** (matches the prompt), a **previewer** (draws the selected item), and **actions** (keys mapped to named functions).
  - Each raw result goes through an `entry_maker` that returns `{ value, display, ordinal }`: the raw record, how it looks, and the text matched against. That keeps display and matching separate, and keeps the original record available to actions.
  - `entry_display.create{ items = { {width = 4}, {remaining = true} } }` declares columns once; each entry then supplies cell text with a highlight group.
  - Previewers have `setup`, `define_preview(entry)`, and `teardown` hooks, can be cycled, and cache per entry.
  - Actions are named, so a user can remap keys without touching picker code (`actions.select_default:replace(fn)`).
  - The status text (`matched / total`) is a hook. Extensions register pickers so one command, `:Telescope <ext> <picker>`, opens any of them.
- **mini.pick.** A picker is one `source` table: `items` (an array, a function, or `nil` with items set later, asynchronously), `name`, `match`, `show`, `preview`, `choose`, and `choose_marked`.
  - Every field except `items` has a default, so a minimal source is just items and a name.
  - Matching uses each item's string form (`text`).
  - One window switches between three views: main (the list), preview, and **info**, which is generated from the active mappings, so help never goes stale.
  - Custom actions are `{ char, func }`; the return value says whether to close the picker.
  - It has marking (select several items, then act on all of them), "refine" (make the current matches the new item set), a border colour for "busy", a registry of named pickers behind one `:Pick` command, and `resume()` to reopen the last picker as it was.

What this plan takes from them:
- the record kept alongside its display, with separate match text (telescope's `value` and `ordinal`, mini's `text`);
- columns declared once per source;
- views as swappable previewers with setup and teardown;
- named actions with default keys and a close-or-stay result;
- help generated from actions;
- a busy state;
- a matched/total status;

What it leaves for later: marking, refine, query syntax (`'exact`, `^`, `$`), user-configurable key maps, and resume. Each is listed in the Decision Log.

### Baseline

On 2026-10-22, at commit `8dca1a3`, `node --test pi/extensions/crew/*.test.ts pi/extensions/subagent/*.test.ts pi/extensions/watch/*.test.ts` reports `ℹ tests 200`, `ℹ pass 200`, `ℹ fail 0`.

## Plan of work

Each milestone leaves every test suite passing and all three panels working in Pi.

### Milestone 1: the shared directory and the shared helpers

Goal: one home for code all three panels use, with no change in behaviour.

Work:
- Create `pi/extensions/run-panel/`, with no `index.ts` and no `link.sh` line, so Pi never loads it as an extension.
- Move into `pi/extensions/run-panel/format.ts`: `Tone`, `Style` (with an optional `markdown`), `SPINNER`, `duration`, `money`, `tildify`, `clean`, `oneLine`, `padStart`, `expandTabs` (from watch), and `box` (crew's version, with text in the bottom border).
  - Keep subagent's `money` behaviour of printing `<$0.01` for tiny amounts.
  - Crew's ledger summary has its own `money` in `crew/state.ts`; leave it as it is.
  - Watch's `clock` (wall-clock time) and subagent's `clock` (elapsed `mm:ss`) differ. Move both, with distinct names.
- Make `crew/panel.ts`, `subagent/panel.ts`, and `watch/panel.ts` import these. Move their tests to `pi/extensions/run-panel/format.test.ts`.
- Move `WatchStore` and its types out of `watch/panel.ts` into `pi/extensions/watch/store.ts`, so the panel file holds only rendering.

Result: all three panels draw exactly as before.

Proof: every suite passes with at least as many tests as before. Each panel opened in Pi looks unchanged.

### Milestone 2: the source interface and the presenter, with crew as the first source

Goal: the crew panel is drawn by a presenter that imports nothing from `crew/`.

#### Work in `pi/extensions/run-panel/`

`source.ts` defines the interface. Fields marked optional have presenter defaults, as in mini.pick.

```ts
export interface Source<T = unknown> {
  name: string;                                  // "Crew add-theme-2zw1", "Subagents", "Watches"
  items(): Item<T>[];                            // display order; called on every render, so keep it cheap
  columns: Column[];                             // declared once (telescope entry_display)
  views: View<T>[];                              // tabs of the details pane (telescope previewers)
  actions: Action<T>[];                          // named; help is generated from these (mini.pick info view)
  header?(): Segment[][];                        // crew: goal, branch, budget bar; others: none
  status?(): string;                             // footer right side; default "matched/total"
  busy?(): boolean;                              // border shows busy (mini.pick)
  subscribe?(onChange: () => void): () => void;  // re-render when data changes; default: render on the presenter's tick only
  dispose?(): void;                              // panel closed: stop timers, drop caches (telescope teardown)
}

export interface Item<T> {
  id: string;                                    // unique within the source; a merged view prefixes it
  value: T;                                      // the record itself, handed back to views and actions
  text: string;                                  // what the filter matches (telescope ordinal, mini text)
  cells: Record<string, Cell>;                   // one per column id
  glyph: Cell;                                   // status mark, e.g. a spinner, ✓, ◷
  running: boolean;                              // picks the initial selection, animates the glyph
  title: string;                                 // details pane title
  defaultView?: string;                          // subagent: "activity" while running, "result" after
}

export interface Column { id: string; width?: number; fill?: boolean; align?: "left" | "right"; drop?: number }
// `drop`: columns with higher numbers disappear first as the list narrows. Crew drops kind, then cost, then activity.
export type Cell = { text: string; tone?: Tone } | string;
export type Segment = { text: string; tone?: Tone; bold?: boolean } | { bar: number; cells: number };

export interface View<T> {
  id: string; label: string;
  render(value: T, ctx: ViewContext): Content;   // synchronous; may return { kind: "loading" }
  tail?: boolean;                                // opens at the end and follows new lines until the user scrolls up
}
export interface ViewContext { now: number; changed(): void }  // a view that loads asynchronously calls changed() when ready

export interface Action<T> {
  id: string; label: string; key: string;        // key: a single printable character, e.g. "x"
  available?(value: T): true | string;           // a string is the reason it's unavailable, shown as a flash
  confirm?(value: T): string;                    // ask with this text; y runs it
  run(value: T): Result | Promise<Result>;
}
export type Result = void | "close" | { flash: string; tone?: Tone };

export type Content =
  | { kind: "loading"; text?: string }
  | { kind: "message"; text: string; tone?: Tone }
  | { kind: "fields"; rows: [label: string, value: string][] }
  | { kind: "markdown"; text: string }
  | { kind: "lines"; lines: string[]; paint?: "diff" }
  | { kind: "collapsible"; items: { head: string; body: string[]; open: boolean }[]; note?: string }
  | { kind: "transcript"; note: string; dropped: number; entries: Entry[] }
  | { kind: "sections"; parts: { title?: string; tone?: Tone; content: Content }[] };
```

Text inside `Content` and `Cell` may already carry colours from the source's Style. The presenter handles wrapping, truncation, scrolling, and painting. `Entry` (one transcript entry: prompt, thinking, text, note, or tool call) moves from `crew/transcript.ts` to `run-panel/source.ts`, and `crew/transcript.ts` imports it from there.

The other files:
- **`state.ts`**: the interaction state, generalised from crew's `PanelState`. It holds the selected id, filter query and whether you're typing one, focus (list or details), view id, scroll, the collapsible cursor and which items are open, follow, zoom, help, the pending confirmation, and the flash message.
- **`input.ts`**: generalised from crew's `panelInput`, `move`, `filterTasks`, and `fuzzyScore`.
  - The filter matches `Item.text`.
  - Number keys pick the n-th view.
  - A letter key that isn't reserved runs the matching action on the selected item, after `available` and `confirm`.
  - Reserved keys are `j k g G l h q ? /`, space, and the digits. The presenter throws when a source declares one, so the mistake shows in tests.
  - `input()` returns the action to run, and the wrapper in `pi.ts` runs it, so `input.ts` stays synchronous and testable.
- **`render.ts`**: generalised from crew's `panelLines`, `taskRow`, `tabBar`, `footer`, `helpLines`, `entryLines`, and `paintDiff`.
  - It lays out the declared columns, dropping them by `drop` as width shrinks.
  - It builds help and footer hints from the source's actions and views.
  - The `collapsible` kind behaves like today's Checks tab: a cursor, `enter` toggles, and failed items open by default because the source sets `open`.
  - Views with `tail` follow new output, as the Live tab does today.
- **`pi.ts`**: everything that touches Pi.
  - `PANEL_KEYS` and `panelEvent` move here from `crew/index.ts`, and `makeStyle(theme)` from the three `index.ts` files.
  - `openPanel(ctx, source, opts)` wraps `ctx.ui.custom` with the overlay options, the tick timer, subscribe and dispose, and the guard against opening twice.
  - This file imports `@earendil-works/pi-tui`, which tests load already, since every `index.ts` imports it.

#### Work in `pi/extensions/crew/`

- **`source.ts`**: `crewSource(getCrew, deps)` returns a `Source<TaskRecord>`.
  - The columns are id, kind, title, time, cost, and activity.
  - The views are today's six tabs. `overview`, `handoff`, `checks`, `diff`, and `live` in `panel.ts` become `View.render` functions that return `Content`. `DiffCache` and `SessionCache` live in the source, and `dispose` drops them.
  - The actions are `x` cancel (confirm, available only when the crew runs in this session), `o` copy the worktree path, and `e` export, using the code in `openPanel()` today.
- **`index.ts`**: `openPanel()` shrinks to choosing the crew and calling `run-panel/pi.ts`'s `openPanel` with a crew source.
- **`panel.ts`**: shrinks to what's still crew-specific (`formatWidget`, if it lives there), or is deleted.

#### Tests

Split `crew/panel.test.ts`:
- Layout, keys, filter, scrolling, follow, confirm, help, and column-dropping tests move to `run-panel/*.test.ts` and use a small fixture source.
- Tests about crew content stay in `crew/source.test.ts`: quiet thresholds, handoff sections, check verdicts, and diff targets.
- The panel tests in `crew/index.test.ts` must keep passing unchanged; they're the check that behaviour didn't move.

Result: the crew panel looks and behaves as before.

Proof: every suite passes. In Pi, in this repo, `/crew-status` opens the finished crew `is-the-extension-code-clean-code-0om6` from the ledger, and all six tabs, the filter, `?`, `ctrl+o`, and `o` work as before.

### Milestone 3: subagents as a source

Goal: `/subagents` is drawn by the presenter.

Work:
- Add `pi/extensions/subagent/source.ts`: `subagentSource(store, cancel)` returns a `Source<JobRecord>`.
  - Columns: id, model, time, tool calls, cost, and what it's doing.
  - Views:
    - Overview: `fields` with cwd, git, tools, spend, calls, and status.
    - Task: `markdown`.
    - Activity: `lines`, one per tool call with its elapsed time, with `tail`.
    - Result: `markdown`; a `message` while the job runs; errors in the error tone.
  - `defaultView` is Activity while running and Result after, which keeps today's default.
  - Action: `x` cancel, with a confirmation, available only while running.
  - `subscribe` uses `JobStore.subscribe`.
- The Style supplies `markdown` everywhere, so `glowRenderer` moves from `subagent/markdown.ts` to `run-panel/markdown.ts`, with its test.
- Delete the popup code from `subagent/panel.ts` (`initialPopup`, `popupKey`, `popupLines`, `bodyLines`, `detail`) and the popup key map from `subagent/index.ts`. Keep `widgetLines`, `summary`, `progressLine`, and `doing`.
- Move the popup tests that still apply to `subagent/source.test.ts`, and drop the layout-only ones that `run-panel` tests now cover.

Result: `/subagents` has the crew panel's layout and keys. `a` and `t` give way to tabs `1`-`4`. The task expander goes away, because the Task tab shows the whole task.

Proof: every suite passes. In Pi, ask for two subagents in parallel ("use two subagents to summarise README.md and link.sh"), open `/subagents` while they run, and check four things:
- the spinner moves;
- Activity follows new tool calls;
- `x` asks before cancelling;
- Result shows markdown once they finish.

### Milestone 4: watches and loops as a source

Goal: `/watches` is drawn by the presenter.

Work:
- Add `pi/extensions/watch/source.ts`: `watchSource(store, registry)` returns a `Source<WatchRecord>`.
  - The glyph reuses today's `icon()` marks.
  - Columns: id, kind (`watch` or `loop`), description, count (`3 checks` or `2 runs`), last exit, and status (`next in 25s`, `due when idle`, `condition met`).
  - Views:
    - Overview: `fields` with kind and mode, cwd, interval, timeout and time left, counts, status, and the whole command or prompt.
    - Log: `lines`, one per log entry as `hh:mm:ss text ×N`, with `tail`.
    - Output: a watch's last check output, or a loop's prompt, with the error first when it ended in one.
  - Action: `x` stop. Confirmation is skipped: stopping is cheap and today's popup doesn't ask. It's available only while the watch is active, and it keeps the `registry.get(id) === watch` guard.
  - Item ids are `WatchRecord.key`, which is unique for the session; `watch.id` is reused.
  - `subscribe` uses `WatchStore.subscribe`. `busy` is true while any check runs; today that only speeds up the spinner.
- Delete the popup code from `watch/panel.ts` and the popup key map from `watch/index.ts`. Keep `widgetLines`.
- Move the popup tests that still apply to `watch/source.test.ts`.

Result: `/watches` has the crew panel's layout and keys; `a` gives way to tabs `1`-`3`.

Proof: every suite passes. In Pi, start `/watch 5s date` and `/loop 1m say hi`, then open `/watches` and check four things:
- the Log tab grows and collapses repeats into `×N`;
- Output shows the last `date`;
- `x` stops the watch;
- the loop shows `due when idle` while Pi is busy.

### Milestone 5: documentation

Work:
- Update `pi/extensions/crew/README.md`, Panel section: the keys are now the shared presenter's.
- Update `pi/extensions/subagent/README.md` and `pi/extensions/watch/README.md`: the new keys and tabs.
- Add `pi/extensions/run-panel/README.md`: what a source provides, with the fixture source from the tests as the example, and the telescope and mini.pick ideas it borrows.
- In `IDEAS.md`:
  - under "Multicrew support", note that showing several crews is now one source per crew;
  - add the deferred ideas: the shared widget, marking, refine, query syntax, and resume.

Proof: each README's key table matches the panel. Check by reading the table with the panel open.

## Validation

From `~/git/dotfiles`:

```sh
node --test pi/extensions/run-panel/*.test.ts pi/extensions/crew/*.test.ts pi/extensions/subagent/*.test.ts pi/extensions/watch/*.test.ts 2>&1 | rg '^ℹ (tests|pass|fail)'
```

Success is `ℹ fail 0`, with `ℹ tests` at least 200, since moved tests keep counting.

```sh
rg -n 'from "\.\./(crew|subagent|watch)/' pi/extensions/run-panel
```

Success is no output: the presenter depends on no extension.

Manual checks in Pi, after `/reload` or a restart, in `~/git/dotfiles`:
- `/crew-status` opens the ledger crew `is-the-extension-code-clean-code-0om6`, and its header, list, and six tabs render as they did before Milestone 2.
- `/subagents` and `/watches` behave as their milestones describe.
- At 80 columns wide, every panel stacks the list above the details instead of side by side.
- `?` in each panel lists exactly that source's actions and views.

## Progress

- [x] (2026-10-22 23:12) Researched the crew and subagent panels and their wiring; recorded the baseline (200 pass).
- [x] (2026-10-22 23:12) Prototyped a cross-directory import through a symlinked extension (see Surprises).
- [x] (2026-10-22 23:40) Read the watch panel; researched telescope.nvim (developer guide, `entry_display`, previewers) and mini.pick (`:h mini.pick`); checked how Pi loads extensions and shares state between them.
- [x] (2026-10-22 23:29) Milestone 1: `run-panel/format.ts` and tests; `watch/store.ts`; all three panels import the helpers. Suite: `ℹ tests 205`, `ℹ pass 205`, `ℹ fail 0` (baseline 200, minus crew's `clean` test, plus 6 in `format.test.ts`, which now also holds that test and the duration/money assertions from subagent's format test). `rg 'from "\.\./(crew|subagent|watch)/' pi/extensions/run-panel` prints nothing.
- [ ] Manual check in Pi for Milestone 1 (each panel looks unchanged): pending for the user.
- [x] (2026-10-23 00:35) Milestone 2: source interface, presenter, crew source; crew panel test split. Suite: `ℹ tests 236`, `ℹ pass 236`, `ℹ fail 0`.
  - [x] (2026-10-22 23:43) Milestone 2a: `run-panel/source.ts`, `state.ts`, `input.ts`, `render.ts`, `pi.ts`, and a crew-shaped fixture source (`run-panel/fixture.ts`) with tests in `run-panel/presenter.test.ts` (32) and `run-panel/pi.test.ts` (8). `Entry` moved to `run-panel/source.ts`; `crew/transcript.ts` imports and re-exports it. The crew panel itself is untouched. Suite: `ℹ tests 245`, `ℹ pass 245`, `ℹ fail 0` (205 + 40). `rg 'from "\.\./(crew|subagent|watch)/' pi/extensions/run-panel` prints nothing.
  - [x] (2026-10-23 00:35) Milestone 2b: `crew/source.ts` (`crewSource`, with `quiet`, `diffTarget`, and `DiffCache` moved from `panel.ts`); `crew/index.ts` `openPanel()` only picks the crew and calls `run-panel/pi.ts`'s `openPanel`; its `PANEL_KEYS`, `panelEvent`, and `panelStyle` are gone. `crew/panel.ts` and `crew/panel.test.ts` are deleted: the 29 crew panel tests became 20 in `crew/source.test.ts` (crew content and actions), and the generic ones were already in `run-panel/presenter.test.ts`. `crew/index.test.ts` is unchanged and passes (31). Suite: `ℹ tests 236`, `ℹ pass 236`, `ℹ fail 0` (245 − 29 + 20). `rg 'from "\.\./(crew|subagent|watch)/' pi/extensions/run-panel` prints nothing. Mutants: `crew/mutants.json` retargeted from `panel.ts` to `source.ts`/`index.ts` (all 13 changed ones killed, run against a whole-tree copy), and the four generic ones moved to a new `run-panel/mutants.json` (`node pi/extensions/test-support/mutate.ts run-panel`: all 4 killed).
  - [x] (2026-10-23 01:10) Milestone 2 review fixes in the presenter, each with a regression test that fails on the old code: (1) `run-panel/pi.ts` cleanup (tick, unsubscribe, `source.dispose`) is one idempotent function run on every close path, on a throwing `subscribe`, and when the overlay settles, not only from `component.dispose()`; (2) `input.ts` follows the selected item's current `defaultView` on every refresh until the user picks a view (`state.viewPicked`); (3) `y` re-checks `action.available` on the item as it is now; (4) `render.ts` and `input.ts` clamp the collapsible cursor when entries go. `run-panel/pi.test.ts`'s fake `ui.custom` now installs the component a microtask later, as Pi does. Suite: `ℹ tests 242`, `ℹ pass 242`, `ℹ fail 0` (236 + 6). `crew/index.test.ts` unchanged; run-panel mutants: all 4 killed.
  - [ ] Manual check in Pi for Milestone 2 (/crew-status opens crew is-the-extension-code-clean-code-0om6 from the ledger; six tabs, filter, ?, ctrl+o, o work as before; 80 cols stacks): pending for the user.
- [ ] Milestone 3: subagent source; popup code removed; manual check.
- [ ] Milestone 4: watch source; popup code removed; manual check.
- [ ] Milestone 5: READMEs and `IDEAS.md`.

Work is committed per milestone on the crew branch (`crew/carry-out-the-execplan-in-agent-*`).

## Surprises & Discoveries

- 2026-10-22: **Shared imports work through the symlinks.** Pi loads an extension that imports `../shared/x.ts` through a symlinked directory. The prototype was `/tmp/proto/link/ext` → `/tmp/proto/real/ext`, whose `index.ts` imports `../shared/x.ts`, run with `pi --no-extensions -e /tmp/proto/link/ext -p hi`. It wrote `shared-ok`, so imports resolve from the real path. This is what lets `run-panel/` exist without its own `link.sh` line, and it removes the reason `watch/panel.ts` gives for copying code.
- 2026-10-22: **No module-level singletons across extensions.** Pi loads each extension with `createJiti(..., { moduleCache: false })` (`dist/core/extensions/loader.js`, around line 477). Two extensions importing `run-panel/pi.ts` get two copies of it, so module-level state can't be shared. Pi does provide a shared bus, `pi.events` (`emit(channel, data)`, `on(channel, handler)`, in `dist/core/event-bus.d.ts`). A combined panel across extensions would need it; that's now an idea in `IDEAS.md`, not part of this plan.
- 2026-10-22 (M1): **The crew panel's `money` is the ledger's, not subagent's.** `crew/panel.ts` imported `money` from `crew/state.ts`, which prints `$0.00` for tiny amounts. Switching it to the shared `money` would have shown `<$0.01` in the crew list and overview, a visible change, so the crew panel keeps the ledger `money` and the shared one is used by subagent only for now.
- 2026-10-22 (M1): **The three `box` functions differed only in the bottom border.** Crew's drew the bottom as two colour spans even with no bottom text; subagent's and watch's drew one. The shared `box` draws one span when there's no bottom text, so subagent and watch output is byte-identical and crew's is identical on screen (only where ANSI colour runs split changes; no test depended on it).
- 2026-10-22 (M1): **`WatchStore` needs `END_MARK` and `endText`.** Its `end()` logs the end text in the end tone, so both moved to `watch/store.ts` with it, and `watch/panel.ts` imports them. `anyChecking` (a query over records) moved too.
- 2026-10-22 (M1): **`sed` in the worker environment was BSD sed**, not GNU sed as Context says; `sed -i 's/…/…/' file` failed. Use the edit tool or `sed -i ''` there.
- 2026-10-22 (M2a): **Collapsible keys need what the last render drew.** `input()` is synchronous and doesn't call views, but moving the cursor and toggling an entry need the entry count and each entry's default `open`. `render()` records them in `state.collapsible` (keyed by item and view, so a stale snapshot is ignored), and toggling flips `expanded[key] ?? default`, so two toggles with no render between them cancel out.
- 2026-10-22 (M2a): **`pi.ts` can't be imported statically by tests.** It imports `@earendil-works/pi-tui`, which resolves only through the stubs `test-support/fake-pi.ts` registers, so `run-panel/pi.test.ts` imports `fake-pi.ts` first and then `await import("./pi.ts")`, as `crew/index.test.ts` does.
- 2026-10-22 (M2a): **Open panels keep the test process alive.** The tick is a `setInterval`; a test that fails before closing its panel hangs `node --test` until the timeout. The pi tests close every panel in `finally` and await `handle.closed`.
- 2026-10-22 (M2a): **Crew-specific wording that the presenter can't know.** The crew Live tab says "… N earlier entries not kept here; e exports the whole session" and "… N more lines; the Spec tab has the task"; the presenter's transcript says "… N earlier entries not kept here" and "… N more lines". The Checks hint becomes "j/k pick an entry · enter opens or closes it", the help drops "Read-only: integrate and dispatch stay with the planner", the confirmation footer is `<confirm text> y to <label>, any other key to leave it`, and declining flashes "Nothing done" rather than "#N keeps running". `crew/panel.test.ts` asserts the old Live strings, so 2b must update or drop those assertions when it splits the file; `crew/index.test.ts` doesn't depend on any of them.
- 2026-10-22 (M2a): **Column layout differs slightly from crew's hand-tuned row.** Crew puts two spaces before the activity column and pads time and cost to 6; the presenter uses one space between every column. With the fixture's columns (`id`; `kind` width 4, drop 3; `title` fill 11; `time` width 5 right; `cost` width 5 right, drop 2; `activity` fill 9, drop 1) everything fits from a 48-column list, as in crew, and the drop thresholds are within a column of crew's.
- 2026-10-23 (M2b): **The crew mutation gate has been broken since Milestone 1.** `test-support/mutate.ts` copies only `pi/extensions/<ext>/` and `test-support/` to a temp dir, so `crew/`'s import of `../run-panel/` fails to load there: `node pi/extensions/test-support/mutate.ts crew` reports "baseline FAILS (load error)" on the 2a commit too. Subagent and watch will hit the same once they import `run-panel/` (they already do, via `format.ts`). Fix outside this plan's scope: copy the whole `pi/extensions/` tree, or the extension plus `run-panel/`. Until then the retargeted crew mutants were checked with a throwaway script that copies the whole tree; all were killed.
- 2026-10-23 (M2b): **`crew/index.test.ts` passed unchanged with no presenter changes.** Its panel tests check crew-specific strings (`Cancel #1 "do it"?`, `Cancelling #1`, `#1 has no session file yet`, `Exporting #1…`, `Export of #1 failed: pi exploded`, `#1 is not running`), which all come from the crew source's actions, and its fake `ctx.ui.custom` drives `run-panel/pi.ts` just as it drove the old overlay.
- 2026-10-23 (M2b): **2a's tick test was flaky under the full suite.** "the tick animates spinners and re-renders" slept a fixed 30 ms for a 5 ms tick and failed about one run in ten when every test file ran in parallel. It now polls for the second render with a 2 s deadline; 6 full runs in a row passed.
- 2026-10-23 (M2b): **Wording that moved with the presenter** (all sanctioned by 2a's note): declining a cancel flashes "Nothing done" rather than "#N keeps running"; the Live tab's dropped-entries line no longer adds "e exports the whole session"; the help no longer says "Read-only: integrate and dispatch stay with the planner"; the Checks tab's dirty-files note wraps rather than being cut at the pane edge. No test asserted the old strings except the deleted `crew/panel.test.ts`.
- 2026-10-23 (M2 fixes): **Pi disposes only a component it has installed.** `showExtensionCustom` (`dist/modes/interactive/interactive-mode.js`, around line 2282) calls the factory synchronously but installs its result in `Promise.resolve(...).then`, and `close` disposes only an installed component; a `.then` that finds the overlay closed returns without disposing. So a `close()` straight after `openPanel()`, or the `closeRequested` microtask, skipped `dispose()` and leaked the tick (which also keeps `node --test` alive: the old code hangs `pi.test.ts` until its timeout). The old test fake disposed whatever the factory returned, which hid this.
- 2026-10-23 (M2 fixes): **Crew sets no `defaultView`**, so following the default on refresh changes nothing in the crew panel; it's for Milestone 3, where a subagent's default moves from activity to result when it finishes.
- 2026-10-22: **The crew panel is already close to this shape.** It isolates its data behind `deps.diff` and `deps.transcript`, so most of Milestone 2 moves code rather than redesigning it.

## Decision Log

- 2026-10-22: **Generalise the crew panel, not the other two.** It has the largest feature set and has 30 tests. Building a new presenter from scratch would mean re-deriving behaviour those tests already pin down.
- 2026-10-22: **Sources are mini.pick-style objects with defaults; views and actions follow telescope's previewers and named actions.** A source author writes data and small functions and never touches layout or keys. The rejected alternative was sources that render their own details pane (like telescope's `define_preview` writing to a buffer). That's flexible, but it would let the panels drift apart again.
- 2026-10-22: **Each item keeps its record (`value`) and a separate match text (`text`).** As in telescope's entry maker: actions and views get the real record, and display can differ from what the filter matches.
- 2026-10-22: **Columns are declared per source, with drop priorities.** Crew drops columns as the list narrows, and watch and subagent have different columns. Telescope's `entry_display` does the same. The rejected alternative was a fixed `Item` shape with `model`, `cost`, and `toolCalls`, which watches don't have.
- 2026-10-22: **The presenter owns interaction state; sources own data and effects.** Selection, view, scroll, filter, follow, cursor, zoom, help, confirm, and flash live in the presenter. A source sees only `View.render` and `Action.run`.
- 2026-10-22: **Views render synchronously and may return `loading`; asynchronous sources call `ctx.changed()`.** That's how `DiffCache` and `SessionCache` already work, and it keeps rendering free of awaits.
- 2026-10-22: **Help is generated from actions and views.** Taken from mini.pick's info view, so help can't go stale. It replaces crew's hand-written `HELP` table.
- 2026-10-22: **One key scheme.** Subagent's `a`, `t`, and `ctrl+o` (expand) and watch's `a` give way to numbered tabs, and `ctrl+o` means zoom everywhere. Consistency across panels is the point of the change.
- 2026-10-22: **One panel for every source (`/runs`) moved to `IDEAS.md`.** It was Milestone 5. Nothing else depends on it, and the user hasn't needed it yet. The source interface keeps it cheap later: string ids, and each item carries its own record, views, and actions.
- 2026-10-22: **Deferred:** the widgets below the editor (they could render from the same items and columns later), marking and acting on several items (mini.pick's `choose_marked`), refine, query syntax, user key maps, and resume. Each is useful but independent, and listed in `IDEAS.md` by Milestone 5.

- 2026-10-22 (M1): **Clock helpers are `wallClock` (watch's `hh:mm:ss` time of day) and `elapsedClock` (subagent's `mm:ss` since start).** Distinct names because they mean different things.
- 2026-10-22 (M1): **`Style.markdown` is optional in the shared `Style`; `subagent/panel.ts` exports `Style = BaseStyle & Required<Pick<BaseStyle, "markdown">>`.** Crew and watch styles don't provide markdown, and the subagent panel calls it unconditionally, so its own type keeps it required until Milestone 3 supplies markdown everywhere.
- 2026-10-22 (M1): **Only the listed helpers moved.** The identical `rule()` in subagent and watch and their popup state/key code stay put: Milestones 3 and 4 delete them with the popups.
- 2026-10-22 (M2a): **Refinements to the planned interface.** Each keeps a source declarative:
  - `Item.text` may be `string[]`: a filter token must match within one field, as crew's filter does today, so letters scattered across fields don't match.
  - `Item.glyph` is optional; unset means an animated spinner in the accent tone. A running watch that's waiting shows `◷`, not a spinner, so `running` alone can't decide.
  - `Item.title` is `string | Segment[]`, so the details title can be coloured without a Style.
  - `Column.fill` is `boolean | number` (a weight), so crew's title can keep the larger share next to activity.
  - `ViewContext` has `style`, so views can colour text inside content (crew's status and verdict tones).
  - `Action` has `description` (help text; `label` is the short footer and confirmation word), and `run(value, ctx)` gets `ctx.flash(text, tone)` for progress such as "Exporting #1…". A result that arrives after a later key press goes to `ctx.ui.notify` instead of the footer, as crew's export does today.
  - `Content` gains `bullets` (crew's `- ` lists with hanging indent), `lines.wrap`, and `collapsible` entries with no `body` (not openable: crew's PENDING checks).
  - `Source.status(matched, total)` gets the counts and shows beside the list title, which is `Source.name` (crew passes "Tasks"; the header carries "Crew <slug>"). `Source.empty` replaces "No tasks yet". `busy` shows a spinner beside the list title rather than recolouring the border, since `box` takes only a focused flag.
- 2026-10-22 (M2a): **`openPanel` returns a handle and guards by id.** It returns `{ close(), closed }` or `undefined` when there's no UI or a panel with the same id (default `source.name`) is open. The guard is a module-level set, which is per extension because Pi loads each with its own module cache. Crew still needs its own flag across the await in `panelCrew` before it calls `openPanel`, and uses `handle.close()` where it calls `closePanel` today.
- 2026-10-22 (M2a): **`input()` returns a command, not the action's effect.** `{ type: "run", action, item }` after `available` and `confirm`; `pi.ts` runs it and applies synchronous results before the next render, so a flash like "#1 has no session file yet" shows at once, as `crew/index.test.ts` expects.
- 2026-10-22 (M2a): **The fixture source lives in `run-panel/fixture.ts`, not inside a test.** Both test files use it, along with the tagged test Style, and Milestone 5's README can point at it as the example source.
- 2026-10-23 (M2b): **`crew/panel.ts` is deleted, not shrunk.** `formatWidget` lives in `crew/state.ts`, so nothing crew-specific was left in it; `quiet`, `diffTarget`, and `DiffCache` moved to `crew/source.ts`.
- 2026-10-23 (M2b): **`crewSource(getCrew, deps)` takes effects as deps.** `live()`, `cancel(id)` (returns whether a worker was stopped), `streamed(task)`, `copyPath`, `exportSession`, the shared `exporting` set, and `fileExists`; tests also inject `diffs`, `sessions`, and `now`. `index.ts` keeps the controllers, transcripts, and ledger reload, so the source has no Pi or process state of its own. `cancel` re-checks `live()` because task ids repeat across crews.
- 2026-10-23 (M2b): **`o` shows the path at once, then "Copied …" when the clipboard finishes.** It's an asynchronous action that calls `ctx.flash(path)` first. If a key arrives before the copy finishes, the presenter turns "Copied …" into a notification; the old panel dropped it silently. Kept, because it's the presenter's single rule for late results.
- 2026-10-23 (M2b): **The panel id is `crew`, and crew keeps its own `panelOpen` flag.** The flag covers the await in `panelCrew` before `openPanel` is called (as 2a anticipated); `handle.closed` resets it, and `session_shutdown` calls `handle.close()`.
- 2026-10-23 (M2 fixes): **Cleanup lives in `openPanel`, outside the component.** One idempotent `cleanup()` (clear the tick, unsubscribe, then `source.dispose()` even if unsubscribe throws) runs from the wrapped `done`, from `component.dispose`, from a throwing `subscribe` (which then rethrows, so the overlay rejects, notifies, and frees the guard), and from the overlay promise's `finally`. Relying on Pi to call `dispose()` was the bug.
- 2026-10-23 (M2 fixes): **A view picked with tab or a digit sticks to that item; otherwise the view follows the item's `defaultView`.** `state.viewPicked` resets when the selection changes. Reconciling happens in `visible()`, which render and every key call, and changing view resets scroll, cursor, and follow, as a tab switch does. An item with no `defaultView` keeps the current view.
- 2026-10-23 (M2 fixes): **`y` re-checks `available`; an unavailable action flashes its reason in the warning tone**, the same as pressing the action key on an unavailable item. A vanished item still flashes "That item is gone".
- 2026-10-23 (M2 fixes): **The collapsible cursor is clamped in two places**: when rendering (against the entries drawn now; 0 for an empty list) and before a key moves or toggles (against the entries last drawn, since `input()` doesn't render views). A list that shrank since the last render therefore toggles the last entry that was drawn; the next render clamps again.
- 2026-10-23 (M2b): **Generic mutants moved to `run-panel/mutants.json`.** "esc leaves the filter in place", "panes never stack", and the two Live-tab follow mutants now target `run-panel/input.ts` and `render.ts`; `run-panel` is self-contained, so the stock mutate tool runs there.
- 2026-10-22 (M1): **Watch store tests stay in `watch/panel.test.ts`, importing from `store.ts`.** The popup tests there build records through `WatchStore`, and Milestone 4 rewrites that file anyway.

## Outcomes & Retrospective

To be filled in at the end.

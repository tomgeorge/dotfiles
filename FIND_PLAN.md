# Plan: a fuzzy picker for herdr (`tg.find`)

Goal: one popup, one keypress, to jump to any workspace, live agent, git
worktree or zoxide directory. This is a Go port of Josh's `find` plugin, and
of the reusable picker inside herdrkit that it's built on.

> This is the plan the code was built from, kept for its reasoning. The code
> has since moved on: the API sketches and file names below are out of date,
> and the package docs in `herdr-plugins/find` are the reference.

Prior art (MIT, github.com/joshrwolf/dots, read at HEAD):

| Josh's file | Lines | What it is |
|---|---|---|
| `crates/herdrkit/src/picker/mod.rs` | 315 | Public API: `Entry`, `Cell`, `Column`, `Group`, `Picker` builder, errors |
| `crates/herdrkit/src/picker/model.rs` | 1193 (≈700 tests) | Pure model: query editing, matching, grouping, scrolling, row layout |
| `crates/herdrkit/src/picker/keys.rs` | 149 | Key → `Command`, fzf's bindings |
| `crates/herdrkit/src/picker/run.rs` | 217 | Terminal loop (ratatui), prompt line with `matched/total` |
| `crates/herdrkit/src/{theme,columns,popup}.rs` | 854 | Colours from herdr's config, cell widths, "show error, wait for key" |
| `find/src/{index,destination,dispatch,main}.rs` | 939 | The plugin: collect sources, build rows, open the choice |

---

## What Josh's picker does (the behaviour to match)

- **Runs in-process.** No fzf subprocess, no text protocol: the value you
  pick is the value you passed in.
- **Match text is separate from display text.** Each row is a set of cells.
  A `tag` cell is drawn but not searched (status glyph, focus marker).
  `hidden_terms` are searched but not drawn (kind, workspace id, pane id,
  agent status), so `'agent 'working` narrows to working agents.
- **Groups, in a fixed order:** workspaces, agents, worktrees, directories.
  Rows sort by score *within* a group, so a few agents aren't buried under
  hundreds of directories. Each group has a divider row
  (`─── agents (2) ───`) that can't be matched or selected.
- **Scoped groups.** Directories are hidden until the query starts with `/`.
  The `/` is removed before matching.
- **Columns per group:** fixed widths plus one `fill` column. Every row in a
  group lines up.
- **Matching:** fzf-style (nucleo) with smart case, Unicode normalisation,
  and path scoring (`/` counts as a word boundary). Supports the fzf atoms
  `'exact`, `^prefix`, `suffix$` and `!not`. Matched characters are
  highlighted.
- **fzf keys:** ctrl-j/n and ctrl-k/p (or the arrow keys) move the cursor;
  PgUp/PgDn move one page. ctrl-h, ctrl-w, ctrl-u, ctrl-a, ctrl-e, ctrl-b and
  ctrl-f edit the query. Enter accepts. Esc, ctrl-c, ctrl-g and ctrl-q abort.
  Alt chords are ignored. Bracketed paste is one edit, with control
  characters removed.
- **The cursor stays on the same entry** when the query narrows.
- **Untrusted text is cleaned.** Control characters in titles or paths
  become `�`, so a row can't break the layout or send escape sequences to the
  terminal.
- **Mistakes in the calling plugin are errors, not silent drops:** no groups,
  a group declared twice, an entry in a group that isn't declared, or a cell
  count that doesn't match the columns.
- **What happens on Enter:**
  - Workspace: `workspace.focus`.
  - Agent: `agent.focus` by pane id.
  - Worktree: `worktree.open {cwd: repo root, path, focus: true}`.
  - Directory:
    - If it has a `.git`, `worktree.open`.
    - Otherwise, if a pane's cwd is that directory, focus that pane's
      workspace.
    - Otherwise, `workspace.create`.
- **Sources:**
  - `session.snapshot`.
  - `worktree.list` for each repo root in the snapshot. If one fails, leave
    it out and log it.
  - `zoxide query -l`. It's optional; if it fails, log it.
  - Remove duplicates: a directory already reachable as a workspace or
    worktree doesn't appear again.
- **Popup:** 100×24 cells (herdr shrinks it to fit the terminal). If
  something fails, it prints the error and waits for a key. Otherwise the
  popup would just vanish and look like a dead keybinding.

---

## Go design

### Packages

```
herdr-plugins/
  go-herdrkit/
    herdr/            + snapshot, focus, worktree, workspace.create (Phase 1)
  find/               new plugin: index, destination, dispatch, main (Phase 5)
    internal/theme/   herdr's palette from its config.toml (Phase 2)
    internal/picker/  pure model + keys (Phase 3), tea runner (Phase 4)
```

The picker and theme live inside `find` because nothing else uses them.
Josh's `nvim` file picker isn't coming over, since Tom already has a file
picker. If a second plugin ever needs them, move them into the SDK then.

### Picker API

```go
type Cell struct{ Text string; Style lipgloss.Style; Searchable bool }
func Text(s string, st lipgloss.Style) Cell  // drawn and searched
func Tag(s string, st lipgloss.Style) Cell   // drawn only

type Entry interface {
    Group() string            // key of a declared group
    Cells(Theme) []Cell       // one per column, called once at build
    HiddenTerms() string      // searched, never drawn; "" for none
}

type Column struct{ Width int } // Width 0 = fill
type Group struct {
    Key, Label string
    Columns    []Column
    Scope      rune // 0 = always visible
}

p := picker.New(items, groups...).Prompt("⚡ ").MatchPaths()
m, err := p.Build()        // pure Model[T]; validation errors here
chosen, ok, err := p.Run() // owns the tty; ok=false means aborted
```

Group keys are strings rather than a second type parameter. Go generics
with `Entry[G]` get noisy, and every mistake already fails in `Build`.

### Model (pure, `picker/model.go`)

`Model[T]` holds items, a prepared haystack per item, the query and caret,
the rows (dividers and items), the positions the cursor can land on, the
cursor and the scroll offset. It has two entry points:

- `Apply(Command) (Outcome, done bool)`
- `Lines(width, height) []string` (already styled)

Like Josh's, it's a pure function of (items, query, cursor, width), so it
can be tested with tables.

**Matching** uses `github.com/junegunn/fzf/src/algo`:

- `algo.Init("path")` once when `MatchPaths` is set. This is the global
  equivalent of nucleo's `set_match_paths`.
- One `util.Slab` per model.
- Terms use `FuzzyMatchV2`, `ExactMatchNaive`, `PrefixMatch` or
  `SuffixMatch`, with `withPos=true` for highlighting.
- The atom parser is ours: about 80 lines. It splits on spaces, handles `'`,
  `^`, `$` and `!`, and uses smart case. nucleo has the same set; skip fzf's
  `|` OR. The parser lives in fzf's `src/pattern.go`, but that's in package
  `fzf`, which pulls in the whole TUI.
- An item's score is the sum of its term scores. Its highlight is the union
  of the term positions.

**A Go-specific simplification:** fzf's `util.Chars` indexes by rune, not by
grapheme. That means the cell offsets and the highlight painting both work
in runes, and Josh's grapheme-offset bugs (combining marks, emoji ZWJ) don't
apply to matching. The caret still moves by grapheme cluster
(`rivo/uniseg`, already a dependency of fzf), so it never lands inside a
cluster.

**Widths and truncation:** `charmbracelet/x/ansi` (`StringWidth`,
`Truncate`), which comes with lipgloss.

### Runner (`picker/run.go`)

This is a thin Bubble Tea program on the alternate screen with bracketed
paste on:

- `KeyPressMsg` → `keys.Command` → `Model.Apply`.
- `PasteMsg` → `InsertText`.
- `WindowSizeMsg` → store the size.
- `View` = prompt line (`prompt + query ... matched/total`) + `Lines`.
- Accept or Abort → `tea.Quit`.

Bubble Tea restores the terminal on every exit path, which replaces
`BracketedPaste` and the manual restore in Josh's `run.rs`.

### Theme (`find/internal/theme`)

This ports `theme.rs`, so the picker uses the same colours as herdr's
sidebar.

- **Config path:** `$HERDR_CONFIG_PATH`, else
  `$XDG_CONFIG_HOME/herdr/config.toml`, else
  `~/.config/herdr/config.toml`.
- **Keys read:**
  - `theme.name`, including its aliases (`latte`, `tokyonight`, `dawn`, …).
  - `theme.custom.{text, panel_bg, overlay0, accent, blue, green, red,
    yellow, selection_bg, mauve}`.
  - `ui.accent` (legacy; `theme.custom.accent` wins).
  - `ui.status_indicators` (`dots` | `symbols`).
- **Roles:** background, strong, muted, accent, blue, green, red, yellow,
  selection_bg, matched, plus the indicator set.
- **Built-in palettes:** 18 of them (catppuccin, catppuccin-latte,
  terminal, tokyo-night(-day), dracula, nord, gruvbox(-light),
  one-dark/light, solarized(-light), kanagawa(-lotus), rose-pine(-dawn),
  vesper). Take the RGB values from Josh's table, and spot-check a few
  against herdr's source for 0.9.1.
- **Colour parsing:** the forms herdr accepts are `#rgb`, `#rrggbb`,
  `rgb(r,g,b)`, the named ANSI colours and `reset`/`default`/`none`/
  `transparent`. Anything invalid becomes cyan, which is herdr's own
  fallback.
- **Errors:** a missing or unparsable config means the default palette
  (Catppuccin Mocha), not an error. A picker that won't draw because a
  colour is misspelled is worse.
- **Status glyphs:**
  - blocked: `×` (symbols) or `●` (dots), red
  - working: `◐` or `●`, yellow
  - done: `✓` or `●`, green
  - idle: `○`, muted
  - unknown: `·`, muted
- **Output:** `lipgloss` colours (`lipgloss.Color("#rrggbb")`, the ANSI
  indices, or `lipgloss.NoColor{}` for reset).
- **TOML:** decode with `github.com/BurntSushi/toml` into a struct that
  covers only these keys. Unknown keys are ignored.

Tom's config has no `[theme]` and sets `status_indicators = "symbols"`, so
in practice he gets Catppuccin Mocha with symbol glyphs.

Tests are ported from `theme.rs`. They check that an empty config gives the
default, that every theme name and alias resolves, that an unknown name
falls back to the default, that custom colours override the named palette,
that `theme.custom.accent` beats `ui.accent`, and every colour form.

---

## Phase 0: Toolchain and dependencies — ½ day

- `flake.nix`: change `go` to `go_1_27`. In the pinned nixpkgs that's
  1.27.1; plain `go` is still 1.26.7. golangci-lint 2.13.2 and gopls there
  are already built with 1.27.1, so the linter accepts the new version.
- Change the `go` directive to `go 1.27` in `herdr-plugins/go.mod` and
  `go-herdrkit/go.mod`. `go.work` gets it through `go work use`/`go mod
  tidy`.
- Add dependencies to the `herdr-plugins` module only. The SDK doesn't
  need any:
  - `charm.land/bubbletea/v2` (v2.0.10)
  - `charm.land/lipgloss/v2` (v2.0.6)
  - `github.com/junegunn/fzf` (v0.74.4). Only `src/algo` and `src/util`
    get compiled; they pull in `rivo/uniseg`, `mattn/go-isatty`,
    `go-shellwords` and `x/sys`.
  - `github.com/BurntSushi/toml`, for herdr's config.
- Check that `make test` and `make lint` still pass on nav and ping after
  the bump.

## Phase 1: SDK additions (`go-herdrkit/herdr/`) — 1–2 days

Follow the existing pattern (`call[W reply[R], R]`, a wire type with
`result()`, missing-field checks, fake-server tests). All of these are in
the vendored schema:

| Method | Go | Notes |
|---|---|---|
| `session.snapshot` | `Snapshot(ctx) (Snapshot, error)` | Workspaces (id, label, focused, agent_status, worktree{checkout_path, repository{key,name,root}}), panes (id, workspace_id, cwd), agents (pane_id, workspace_id, agent_status, display name, terminal_title_stripped). Helpers: `EffectiveWorkspaceDir`, `RepositoryRoots`. This is the largest reply, so check the frame cap. |
| `workspace.focus` | `FocusWorkspace` | |
| `workspace.create` | `CreateWorkspace(cwd, label, focus)` | |
| `agent.focus` | `FocusAgent(PaneID)` | target = pane id, not name |
| `worktree.list` | `ListWorktrees(cwd)` | `IsOpenable()` = not bare, not prunable |
| `worktree.open` | `OpenWorktree(cwd, path, focus)` | `cwd` = repo root, `path` = checkout |

Check against the live server: which snapshot fields are nullable, and
whether a workspace with no checkout omits `worktree` or sends `null`.

## Phase 2: Theme (`find/internal/theme`) — 1 day

See "Theme" above. It's pure: `Load()` reads the file and
`fromConfig(cfg)` does the rest, and the table tests cover `fromConfig`.

## Phase 3: Pure picker (`find/internal/picker`) — 3–4 days

Files: `picker.go` (API, validation), `model.go`, `match.go` (the atom
parser plus fzf algo), `keys.go` (a `tea.KeyPressMsg` → `Command` map, so
the tests run without a tty), `layout.go` (budgets, dividers, painting),
`clean.go`.

Port Josh's model tests one by one. The names are the spec:

- **Grouping:** an empty query shows only the unscoped groups. The sigil
  switches to the scoped group and isn't matched. A bare sigil shows the
  whole scoped group. There's one divider per group, only when the group
  has hits, and its count is exact. The group label can't be matched.
  Scores sort within a group, not across the list.
- **Cells:** a tag cell is drawn but not matched. A hidden term matches but
  isn't drawn. A highlight doesn't shift after an empty searchable cell.
- **Cursor:** it never lands on a divider. Large jumps stop at the last
  item. A narrower query keeps it on the same entry. Scrolling keeps it on
  screen and shows the group's divider when there's room. No matches means
  no selection.
- **Layout:** every row is exactly the width asked for, selected or not.
  Columns line up within a group. A fixed column after a fill keeps its
  width. Two fills split the remainder. Oversized columns are clipped.
- **Editing:** ctrl-w stops at a word boundary. Insert happens at the caret.
  A paste is one edit and can't inject control characters. The caret never
  stops inside a grapheme cluster.
- **Validation:** no groups, a duplicate group, an undeclared group and a
  wrong cell count are each an error.
- **Keys:** every fzf binding. Alt chords and unmapped keys are ignored.

## Phase 4: Runner — ½–1 day

`Run()` on Bubble Tea, with a teatest-style smoke test (send keys, assert
the choice). Try it by hand in a real herdr popup: Esc must reach us, and
the popup must close when the process exits.

## Phase 5: `find` plugin (`herdr-plugins/find/`) — 2–3 days

- `herdr-plugin.toml`:
  - `id = "tg.find"`.
  - One `[[panes]]` with `id = "picker"`, `placement = "popup"`,
    `width = 100`, `height = 24` and `command = ["./bin/herdr-find"]`.
  - A `[[build]]` step like nav's.
- `main.go`:
  - Require `HERDR_PLUGIN_ENTRYPOINT_ID == "picker"`.
  - Collect, then pick, then dispatch.
  - On error, print it to stderr and wait for one key before exiting.
    Keep this in `main.go`; nothing else needs it.
- `index.go`: `Sources{Snapshot, Worktrees, Dirs}`, and
  `Destinations(home)` as a pure function. Josh's rules:
  - A workspace takes its branch from the worktree listing, joined on the
    checkout path.
  - An agent inherits its workspace's repo and branch.
  - Bare or prunable worktrees are left out.
  - A worktree that's already open isn't offered twice.
  - A zoxide directory that's reachable another way is dropped.
  - Paths show `~/`, but sibling paths like `/home/developer` don't.
- `destination.go`: the four kinds, the column table (glyph 2, repo 14,
  branch 24, fill, mark 2; agents: glyph 2, name 16, repo 13, branch 20,
  fill), `HiddenTerms`, and groups with directories scoped to `/`.
- `dispatch.go`: the four `open` routes above. Errors name what was being
  opened.
- Tests:
  - A hand-written `testdata/sources.json` with neutral names, no live
    captures.
  - Index table tests.
  - Dispatch against the fake server: assert the method and params.
  - "An agent's task is still readable at `FIXED_CELLS + 24`".
  - The kind and status can be typed (`'agent 'working` → 1).

## Phase 6: Wiring — ½ day

- `herdr/config.toml`: add a `[[keys.command]]` that runs
  `"$HERDR_BIN_PATH" plugin pane open --plugin tg.find --entrypoint picker`.
  Default key: `prefix+shift+p`, which Josh uses and which isn't bound in
  our config.
- `make link` already links every `*/herdr-plugin.toml`, so nothing else is
  needed. Ask before running it against the live herdr.

**Total: about 2 weeks part-time.**

---

## Decisions

- **Go 1.27, Bubble Tea v2, Lip Gloss v2, fzf's algo, BurntSushi/toml.**
- **Colours come from herdr's own config**, the same as the sidebar.
- **No `nvim` file picker.** Tom already has one. The picker stays inside
  `find` with no preview or multi-select hooks.
- **Keybinding:** `prefix+shift+p`, unless Tom wants another.
- **fzf's `algo.Init` is global state.** That's fine in a one-shot popup
  process. Document it where it's called.

## Risks

- **Snapshot size.** With many panes and agents, a snapshot could get close
  to the frame cap. Measure it on the live server once.
- **Popup tty behaviour** (Esc, resize, closing on exit) comes from Josh's
  comments. Check it in Phase 4 before building Phase 5 on it.
- **Theme drift.** The palette table is copied, so it goes stale when
  herdr adds or changes a theme. An unknown name falls back to the default,
  which is safe but wrong. Re-check the table when herdr is upgraded.
- **Crediting Josh.** Credit herdrkit (MIT) in the picker's package doc,
  the way `client.go` and `apps.go` already do.

---

## Status: implemented (2026-09)

Phases 0–6 are done. `make test` and `make lint` pass. The binary was run
against the live server, reading only (snapshot, worktree lists, then Esc).
It hasn't been linked or bound live yet: that needs `make link` and
`herdr server reload-config`.

Where the code departs from the plan above:

- **Status colours follow Herdr, not Josh.** Herdr's sidebar draws done in
  teal and idle in green (`src/client/shell.rs`); Josh mutes idle. So the
  theme has a `Teal` role.
- **The palettes come from Herdr's source**, generated from v0.9.1's
  `src/app/state.rs`. They match Josh's table exactly.
- **Legacy `ui.accent`** applies only when it isn't Herdr's default `cyan`
  and `theme.custom.accent` is unset, which matches Herdr.
- **`theme.auto_switch` is ignored.** The popup can't tell which appearance
  Herdr picked, so it uses `theme.name`.
- **The query language is all of fzf's extended search**, including `|`
  for OR and `'term'` for exact boundary matches. Two fzf behaviours carry
  over:
  - `$` anchors to the end of the whole row, including its hidden terms.
  - Diacritics are ignored only when the query has none: `cafe` finds
    `café`, `cáfe` doesn't find `cafe`.
- **The model returns `Line`/`Span` values**, not ANSI. The runner styles
  them with Lip Gloss, and the tests assert on plain data.
- **Dispatch is tested against a fake `api` interface** (the same pattern
  as nav) rather than a fake socket server. The SDK's socket-level
  behaviour has its own tests in `go-herdrkit`.

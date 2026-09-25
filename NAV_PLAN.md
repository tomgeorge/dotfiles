# Plan: unified navigation across nvim, herdr and WezTerm

Goal: the same keys move focus through every layer, whichever layer
currently holds the pane.

| Keys | nvim | herdr | WezTerm |
|---|---|---|---|
| `ctrl+h/j/k/l` | `wincmd`; at its edge, run `herdr-nav pane <dir>` | nav plugin: send the key to vim/fzf, else move pane focus; at the edge, go to WezTerm | Send through if herdr or nvim is in front, else `ActivatePaneDirection` |
| `ctrl+a ]` / `ctrl+a [` | (herdr sees the prefix first) | nav plugin: next/previous herdr tab; past the last/first tab, go to WezTerm | Send `ctrl+a` through if herdr is in front, else a one-shot leader table |

Each layer handles the key if it can and otherwise passes it outward.
herdr doesn't cover `]t`/`[t` from nvim tabs yet (see "Later").

Background and the SDK design live in `HERDR_SDK.md` and `HERDR_CONTEXT.md`.
Prior art: `herdr-plugins/nav` in github.com/joshrwolf/dots (Rust, MIT). It
covers only the herdr layer: no nvim edge fallback, no WezTerm handoff, no
tabs.

---

## Facts this plan relies on (checked against herdr 0.9.1 / protocol 22)

- `pane.focus_direction` returns `{changed, reason}`, where `reason` is
  `"no_neighbor"` at an edge. One call both moves focus and detects the edge,
  so a pane move costs at most two socket calls: `pane.process_info`, then
  `pane.focus_direction` or `pane.send_keys`.
- `tab.list {workspace_id}` returns `TabInfo{tab_id, number, focused, …}`, and
  `tab.focus` takes a `TabTarget`.
- Plugin processes get `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`, `HERDR_TAB_ID`,
  `HERDR_WORKSPACE_ID`, `HERDR_PLUGIN_ACTION_ID`.
- herdr panes inherit a **stale** `WEZTERM_PANE` from wherever the server
  started. Instead,
  `wezterm cli list-clients --format json` returns `focused_pane_id` for the
  focused WezTerm pane, and it works without `WEZTERM_PANE`.
- `wezterm cli activate-pane-direction --pane-id N <Dir>` and
  `wezterm cli activate-tab --tab-relative ±1 [--no-wrap] --pane-id N` exist.
- nvim can't use `herdr plugin action` at its edge. The plugin would see nvim
  in front and send the key back to it, in a loop. nvim runs the binary
  directly, which skips sending keys to vim.
- Local fish uses vi key bindings. The plugin taking `ctrl+h/j/k/l` costs
  backspace, execute, kill-line and clear-screen, all of which have other keys
  in vi mode. `ctrl+a` is `fish_vi_inc` and is already shadowed by the WezTerm
  leader, so this changes nothing there. fzf.fish uses `ctrl-alt-{f,l,s,p}`, so
  don't use ctrl+alt chords for herdr.
- Go is only available in the dev shell (`nix develop` / direnv), not on the
  global PATH.

---

## Phase 0: Prerequisites (restructure)

### 0.1 Directory layout

```
link.sh                         # links herdr-nav into ~/.local/bin
herdr-plugins/
  Makefile                      # build/link/test/lint; run in the direnv shell
  go.work                       # use ./go-herdrkit and .
  go.mod                        # module github.com/tomgeorge/dotfiles/herdr-plugins
  flake.nix, flake.lock, .envrc # moved from go-herdrkit/ (dev shell covers both)
  .gitignore                    # */bin/
  go-herdrkit/                  # the SDK, moved from ./go-herdrkit (minus examples/, Makefile, flake)
    go.mod                      # module github.com/tomgeorge/go-herdrkit (unchanged)
    herdr/  schema/
  ping/                         # moved from go-herdrkit/examples/ping
    herdr-plugin.toml  main.go  bin/
  nav/                          # new
    herdr-plugin.toml  *.go  bin/
```

- **Why two modules and a `go.work`:** the SDK keeps its own module path, so it
  can be published later. The plugins share one module, which makes
  `go test ./...` cover all plugins at once.
- **Plugin roots:** each plugin directory is a herdr plugin root (manifest plus
  `bin/`) and a `package main` in the plugins module.
- **Git history:** use `git mv` so the moves keep their history.

### 0.2 Plugin ids

Rename `go-herdrkit.ping` to `tg.ping`, and give the new plugin the id `tg.nav`.
`go-herdrkit` names the SDK, not the plugin suite. Unlink the old id
(`herdr plugin unlink go-herdrkit.ping`).

**Done:** the `prefix+i` ping binding has been removed from
`herdr/config.toml`; it only existed to prove plugin linking worked. `ping`
stays as a no-binding smoke plugin: the e2e harness invokes it with
`herdr plugin action invoke`.

### 0.3 `herdr-plugins/Makefile`

**Done.** Kept inside `herdr-plugins/` for now, and it assumes the direnv dev
shell (`go` and `golangci-lint` on PATH); no `nix develop` fallback.

Targets: `build` (`build-<name>` per plugin, atomic rename into `bin/`),
`link` (builds, then `herdr plugin link` each plugin; a failed link is fatal),
`test` (SDK and plugins, `-race`), `test-e2e`, `test-all`, `lint`.

- The manifests' `[[build]]` is `["make", "-C", "..", "build-<name>"]`, so
  `herdr plugin install` and the Makefile build the same way.
- `link.sh` gets `link herdr-plugins/nav/bin/herdr-nav ~/.local/bin/herdr-nav`
  (Phase 2, once the binary exists). Check that `~/.local/bin` is on PATH for
  nvim. Otherwise nvim uses the absolute path.
- `HERDR_SDK.md` §3 layout updated.
- Deleted `install.sh` (stale: `~/dotfiles`, zshrc).

**Check:** in `herdr-plugins/`, `make link` builds and links both plugins.
`herdr plugin list` shows `tg.ping`, and
`herdr plugin action invoke tg.ping.ping` shows the toast.

---

## Phase 1: SDK additions (`herdr-plugins/go-herdrkit/herdr/`)

Use the existing `call[W, R]` pattern. Wire structs use pointers for required
fields, and `result()` rejects a missing field.

| File | Adds | Method → result tag |
|---|---|---|
| `ids.go` | `PaneID`, `TabID`, `WorkspaceID`; `Direction` (`left/right/up/down`) | n/a |
| `pane.go` | `ProcessInfo(ctx, PaneID) (ProcessInfo, error)` | `pane.process_info` → `pane_process_info` |
| | `ProcessInfo.Find(func(name string) bool) *Process`. Matches `name` or the base name of `argv0` | n/a |
| | `SendKeys(ctx, PaneID, ...string) error` | `pane.send_keys` → `ok` |
| | `FocusDirection(ctx, PaneID, Direction) (FocusResult, error)`, where `FocusResult{Changed bool; Reason FocusReason}` | `pane.focus_direction` → `pane_focus_direction` |
| `tab.go` | `ListTabs(ctx, WorkspaceID) ([]TabInfo, error)` | `tab.list` → `tab_list` |
| | `FocusTab(ctx, TabID) error` | `tab.focus` → `ok` |
| `apps.go` | `AcceptsVimNavigation(name)`, `IsFzf(name)` | n/a |

- **Name lists** are ported from herdrkit's `apps.rs`, with MIT credit:
  - `vi vim vimdiff view ex rvim rview evim eview nvi nvim nvimdiff`
  - `vim.<variant>`
  - case-insensitive, `.exe` stripped
- **Reason enum:** `FocusReason` gets an `Unknown` fallback, following the enum
  rule in `HERDR_SDK.md`.
- **Tests:** `fakeServer` cases per method (success, wrong tag, missing
  required field, `APIError`), plus table tests for the name lists.

**Done.** Differences from the table above:
- Enums live in `enums.go`: `FocusReason` and `AgentStatus` (needed by
  `TabInfo`), both mapping unknown values to an `Unknown` constant.
  `Direction` stays in `ids.go`; it's only ever sent, never decoded.
- `FocusResult` also carries `SourcePaneID` and `FocusedPaneID`. `layout` is
  required by the schema, so its presence is checked, but it isn't decoded.
- An empty `PaneID`/`WorkspaceID` is omitted from the request, so the server
  uses the caller's pane/workspace.
- `HERDR_LIVE=1` adds read-only live tests for `ProcessInfo` and `ListTabs`.

**Check:** `make test lint` (in `herdr-plugins/`).

---

## Phase 2: nav plugin (`herdr-plugins/nav/`)

### Manifest

```toml
id = "tg.nav"
name = "nav"
version = "0.1.0"
min_herdr_version = "0.9.1"
description = "ctrl+hjkl and tab navigation shared between vim, herdr and WezTerm"
platforms = ["macos", "linux"]

[[build]]
command = ["make", "-C", "../..", "build-nav"]

# one [[actions]] block each for: left, down, up, right, tab-next, tab-prev
[[actions]]
id = "left"
title = "Navigate left"
contexts = ["workspace"]
command = ["./bin/herdr-nav"]
```

### Entry points (`main.go`)

- **`HERDR_PLUGIN_ACTION_ID` set** (herdr keybinding):
  - direction actions run `paneMove(dir, forward=true)`
  - `tab-next`/`tab-prev` run `tabMove(±1)`
- **Args `pane <dir>`** (nvim at its edge): `paneMove(dir, forward=false)`.
  - With no `HERDR_SOCKET_PATH`, this is plain nvim in WezTerm. It goes
    straight to WezTerm using `$WEZTERM_PANE`, which is correct outside herdr.
- **General:** 2-second context timeout. Errors go to stderr, which herdr keeps
  in `herdr plugin log`. Exit non-zero on error.

### Logic (`nav.go`, pure and table-tested)

```
paneMove(dir, forward):
  if forward:
    info, err := ProcessInfo(pane)          # on error: log it and fall through to moving focus
    if decide(dir, info) == Forward: SendKeys(pane, chord(dir)); return
  r := FocusDirection(pane, dir)
  if !r.Changed && r.Reason == NoNeighbor: outer.PaneDirection(dir)

decide(dir, info):
  vim in front                   -> Forward
  fzf in front and dir is up/down -> Forward   # ctrl+h/l edit the query in fzf
  otherwise / unknown            -> MoveFocus

tabMove(delta):
  tabs := ListTabs(HERDR_WORKSPACE_ID) sorted by number
  i := index of HERDR_TAB_ID
  if 0 <= i+delta < len(tabs): FocusTab(tabs[i+delta])
  else: outer.Tab(delta)
```

### WezTerm side (`outer.go`)

- `type Outer interface { PaneDirection(Direction) error; Tab(delta int) error }`.
  Unit tests use an in-process fake.
- `HERDR_NAV_OUTER_LOG=<file>` replaces the real implementation with one that
  appends `pane left` / `tab +1` lines to the file. The e2e harness uses this
  to assert on the handoff to WezTerm, since WezTerm's GUI can't be driven
  headlessly.
- The real implementation:
  - finds `wezterm` with `exec.LookPath`, falling back to
    `/etc/profiles/per-user/$USER/bin/wezterm`
  - gets the pane id: from `list-clients --format json`, the client with the
    smallest `idle_time`, then its `focused_pane_id`. Outside herdr it uses
    `$WEZTERM_PANE`.
  - runs `activate-pane-direction --pane-id N Left|Right|Up|Down`
  - for tabs, runs `activate-tab --tab-relative ±1 --pane-id N`
- **Guard:** it does nothing, with a log line, when wezterm is missing or has
  no clients.

**Done.** Notes:
- `nextTab` falls back to the focused tab when `HERDR_TAB_ID` is missing
  or not in the list.
- A focus that didn't change for a reason other than `no_neighbor` stays put;
  only the edge hands off.
- `~/.local/bin` is **not** on PATH in bash or fish here, so the `link.sh`
  entry doesn't make `herdr-nav` executable from nvim yet. Decide in
  Phase 3: add `~/.local/bin` to PATH, or have nvim use the absolute path.

**Check:** `make test lint`, then `make link`, then
`herdr plugin action` (list) shows the six actions.

---

## Phase 3: Config wiring

### `herdr/config.toml`

```toml
[keys]
prefix = "ctrl+a"
copy_mode = "prefix+y"          # frees prefix+[
# The nav plugin owns ctrl+hjkl. If it isn't linked, these keys do nothing,
# which is why `make link` fails loudly.
focus_pane_left = ""
focus_pane_down = ""
focus_pane_up = ""
focus_pane_right = ""
split_horizontal = ["prefix+minus", "prefix+'"]
split_vertical = ["prefix+v", "prefix+shift+5"]
zoom = ["prefix+z", "prefix+o"]
```

`[[keys.command]]`, `type = "plugin_action"`:
- `ctrl+h` → `tg.nav.left`
- `ctrl+j` → `tg.nav.down`
- `ctrl+k` → `tg.nav.up`
- `ctrl+l` → `tg.nav.right`
- `prefix+]` → `tg.nav.tab-next`
- `prefix+[` → `tg.nav.tab-prev`

One more, `type = "shell"`: `prefix+ctrl+l` runs
`"$HERDR_BIN_PATH" pane send-keys "$HERDR_ACTIVE_PANE_ID" ctrl+l` and sends a
literal clear-screen.

**Check:** `herdr config check`, then `herdr server reload-config`.

### `wezterm/wezterm.lua`

- Remove `leader`. Move the current leader bindings into
  `key_tables.leader`, and keep `a`, which sends a literal `ctrl+a`.
- Helper `front(pane)`: the base name of `pane:get_foreground_process_name()`,
  matched against `herdr` and vim names.
- `ctrl+a` (`action_callback`):
  - herdr in front: `SendKey ctrl+a`
  - otherwise: `ActivateKeyTable{name="leader", one_shot=true, timeout_milliseconds=1000}`
- `ctrl+h/j/k/l`:
  - herdr or vim in front: `SendKey`
  - otherwise: `ActivatePaneDirection`
- Leader `]`/`[` stay `ActivateTabRelative(±1)`. They only run when herdr isn't
  in front.

### `nvim/lua/nav.lua` + `nvim/lua/mappings.lua`

```lua
-- Move within nvim; at nvim's edge, hand off to herdr/WezTerm.
function M.go(dir)  -- dir: "h"|"j"|"k"|"l"
  local win = vim.api.nvim_get_current_win()
  vim.cmd.wincmd(dir)
  if vim.api.nvim_get_current_win() == win and vim.fn.executable("herdr-nav") == 1 then
    vim.system({ "herdr-nav", "pane", ({ h = "left", j = "down", k = "up", l = "right" })[dir] })
  end
end
```

`M.window` in `mappings.lua` points `<C-h/j/k/l>` at `require("nav").go`.
Run stylua.

---

## Phase 4: Automated tests

Three levels. Each layer is covered by the cheapest test that exercises it.

### Spike results (already verified by hand, 2026-09)

An isolated herdr can be driven by real keypresses and read back over its
socket, without touching the user's live session:

```sh
T=$(mktemp -d); mkdir -p $T/.config/herdr   # write a minimal config.toml here
tmux -L hn -f /dev/null new-session -d -x 160 -y 40 \
  "env -i HOME=$T PATH=$PATH TERM=xterm-256color herdr"
H="env -i HOME=$T PATH=$PATH herdr"   # env -i: drop the live HERDR_SOCKET_PATH
tmux -L hn send-keys C-a v             # real key -> herdr keybinding -> split
$H pane list | jq '.result.panes[] | {pane_id, focused}'   # p2 focused
tmux -L hn send-keys C-a h             # focus left
$H pane list ...                                            # p1 focused
$H pane run w1:p2 "nvim -u NONE -c vsplit"
$H pane process-info --pane w1:p2      # foreground_processes: ["nvim"]
$H pane read w1:p2                     # screen text, shows the vsplit
```

Lessons:
- **`HOME=$T` isolates everything:** config, sockets and logs all land under
  `$T/.config/herdr`.
- **Scrub the environment.** A test started from inside herdr inherits
  `HERDR_SOCKET_PATH`, which beats the session lookup and hits the **live**
  server. Always use `env -i`.
- **Two ways to inject keys:**
  - `tmux send-keys` reaches the herdr *client*, so it tests herdr's
    keybindings.
  - `herdr pane send-keys` writes straight to the pane's program, bypassing
    herdr's keybindings. It's good for driving nvim.
- **Still to verify:** `herdr plugin link` under `HOME=$T` writes
  `$T/.config/herdr/plugins.json` and leaves the real one alone.

### Level 1: unit tests (`make test`, every change)

- SDK: `fakeServer` tests per method (Phase 1).
- nav: table tests for `decide`, `nextTab` and the edge → outer handoff, using
  a fake SDK client and a fake `Outer`.
- nvim: `nvim --headless -u NONE -l nvim/lua/nav_test.lua`. Stub
  `vim.system`, open splits, and assert which direction it hands off at each
  edge. It should hand off only when `wincmd` didn't move.
- WezTerm: `wezterm --config-file wezterm/wezterm.lua show-keys` must exit 0
  and list `ctrl+a` and `ctrl+h`. This only checks that the config loads and
  the keys are bound. The callbacks' logic lives in a small `nav.lua` module
  that takes `pane` as an argument, and gets a table test under `nvim -l`
  with a stubbed `wezterm` module.

### Level 2: e2e through a real herdr (`make test-e2e`, needs tmux + herdr)

`herdr-plugins/nav/e2e_test.go`, behind a `//go:build e2e` tag. It uses Go
tests so the SDK client can read state (no jq), and `t.Cleanup` kills tmux and
the server.

Harness (`e2e/harness.go`):
- `T := t.TempDir()`, shortened with `os.MkdirTemp("", "hn")` because of
  macOS's socket path limit.
- Write `config.toml` from the real `herdr/config.toml`, keeping only
  `[keys]` and `[[keys.command]]`, plus `onboarding = false` and
  `default_shell = "sh"`. This way the test covers the real bindings.
- `herdr plugin link` runs the nav plugin under `HOME=T`.
- Start tmux on a private socket (`-L hn-<pid>`) with the herdr client in it.
  Wait until `ping` answers.
- `outer.log`: `HERDR_NAV_OUTER_LOG=$T/outer.log` goes into the server's
  environment, so plugin actions inherit it.
- Helpers:
  - `keys(...)`: `tmux send-keys`
  - `focused()`: `pane.list` for the focused pane
  - `waitFocused(id)`: poll every 20 ms, 2 s timeout, no sleeps
  - `outer()`: lines of `outer.log`

Cases:

| # | Setup | Keys | Expect |
|---|---|---|---|
| 1 | p1 \| p2, sh in both, focus p2 | `C-h` | p1 focused, outer log empty |
| 2 | same, focus p1 | `C-h` | p1 still focused, outer log `pane left` |
| 3 | p2 runs `nvim -u NONE --listen $T/nv -c vsplit`, right window | `C-h` | herdr focus unchanged, nvim `winnr()` is 1 (read with `nvim --server $T/nv --remote-expr`) |
| 4 | same, nvim left window, nvim loaded with `nav.lua` | `C-h` | p1 focused: nvim hit its edge and ran `herdr-nav pane left` |
| 5 | p2 runs `fzf` | `C-j` then `C-h` | fzf gets `C-j` (herdr focus unchanged); `C-h` moves to p1 |
| 6 | 3 tabs, on tab 2 | `C-a ]` | tab 3 focused |
| 7 | on the last tab | `C-a ]` | tab unchanged, outer log `tab +1` |
| 8 | on the first tab | `C-a [` | outer log `tab -1` |
| 9 | any | `C-a y` | copy mode is active (`pane read` or the mode bar in `tmux capture-pane`) |
| 10 | any | `C-a C-l` | the pane's screen is cleared (literal ctrl+l reached sh) |

- Case 4 needs `herdr-nav` on the pane's PATH. The harness prepends the
  plugin's `bin/`.
- `make test-e2e` = `go test -tags e2e -count=1 ./nav/...`.
  If `tmux` or `herdr` isn't on PATH, it skips with a message rather than
  failing.
- **Latency comes free:** record the time from `send-keys` to
  `waitFocused` for cases 1 and 4, and log it. Fail if it's over a generous
  threshold (say 250 ms), to catch regressions rather than to benchmark.

### Level 3: WezTerm (manual, short checklist)

WezTerm's GUI key handling can't be driven headlessly, and
`wezterm cli send-text` bypasses key bindings. What's left is small and
already covered in the logic tests above:

1. Move with ctrl+hjkl in each setup:
   - nvim split inside herdr: nvim → herdr pane → WezTerm pane, then back
   - fish inside herdr
   - fzf inside herdr: only `j/k` go to fzf
   - plain nvim in WezTerm
   - plain WezTerm splits
2. `ctrl+a ]` / `[`: herdr tabs, then past the last one into the next WezTerm
   tab. In a plain WezTerm tab, it switches WezTerm tabs.
3. `ctrl+a` then a herdr key (for example `c`, `v`, `y`) inside herdr. In a
   plain tab, the WezTerm leader bindings still work.
4. `herdr plugin log list --plugin tg.nav` is clean.

Only the steps that cross WezTerm need a human: 1 (the WezTerm parts), 2 and
3. The rest is covered by level 2.

---

## Risks / open questions

- **herdr under Ghostty:** reaching herdr's edge would shift focus in a
  background WezTerm window. Possible guard: only go to WezTerm when the
  plugin's environment has `TERM_PROGRAM=WezTerm`. Not yet checked whether
  herdr passes that through.
- **Two WezTerm tabs attached to one herdr server:** not yet checked whether
  `HERDR_TAB_ID` / `focused` is tracked for each client.
- **Race:** the foreground process can change between `process_info` and
  `send_keys`. herdr has no single call that does both (herdrkit has the same
  problem).
- **Moving from WezTerm into herdr** lands on herdr's last focused tab or pane,
  not the one nearest the direction of travel.
- **`list-clients` picks by smallest idle time.** With several GUI windows or
  mux clients, this can pick the wrong one.
- **e2e flakiness:** the herdr client inside tmux sees a plain tmux terminal,
  not WezTerm, so key encoding can differ (for example `C-h` vs Backspace).
  Poll instead of sleeping. If a key is ambiguous, set
  `tmux set -g extended-keys always` in the test session.
- **e2e against a live machine:** the `env -i` scrub is the only thing
  between the test and the live server. The harness asserts that
  `HERDR_SOCKET_PATH` points under `T` before sending any key.

## Later

- `]t`/`[t` in nvim: at the last or first nvim tab, run
  `herdr-nav tab next|prev`. Needs a direct entry point for tabs. Decide how it
  should behave when the next herdr tab is also nvim.
- The `plugin` package from `HERDR_SDK.md` Phase 4 (full invocation parsing).
  nav reads only the few env vars it needs.

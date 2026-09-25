# Herdr context: Josh's plugin suite + our Go SDK plan

This is a handoff doc for an agent starting work on a Go SDK for Herdr.

- The plan to execute is in `HERDR_SDK.md`, in this same directory.
- This file covers the background: what Herdr is, what the coworker (Josh) has
  already built, and the lessons worth keeping.

## Herdr basics

- **Herdr** is a terminal workspace manager for AI coding agents. Its model is
  server → workspaces → tabs → panes; panes can host agents.
- **Installed version:** 0.9.1, socket protocol 22. Binary at
  `/etc/profiles/per-user/tom.george/bin/herdr` (nix).
- **Docs index:** https://herdr.dev/llms.txt. The raw pages live at
  `https://raw.githubusercontent.com/herdrdev/herdr/v0.9.1/docs/next/website/src/content/docs/<page>.mdx`.
  The most relevant pages are `plugins`, `socket-api` and `configuration`.
- **Socket API spec:** `herdr api schema --json` (~277 KB, JSON Schema 2020-12).
  It has 103 request methods, about 70 result variants tagged by `result.type`,
  26 event kinds and 3 subscription-event kinds.
- **Plugins** are directories containing a `herdr-plugin.toml` manifest that
  declares:
  - `[[actions]]`, scoped to global, workspace or pane contexts
  - `[[panes]]`, with placement `popup`, `split` or `overlay`
  - `[[startup]]` and `[[events]]` hooks
  - `[[link_handlers]]`, which map a URL regex to an action
  - `[[build]]`

  Herdr spawns the declared command once per invocation and passes context in
  `HERDR_*` env vars. The plugin talks back over the Unix socket at
  `HERDR_SOCKET_PATH`.
- **Reload behaviour:**
  - Herdr doesn't watch its config. Changes to `config.toml` need
    `herdr server reload-config` or the "reload config" menu item. Some
    settings only apply after a restart.
  - Plugin binaries are spawned fresh on each invocation, so a rebuilt binary
    is picked up on the next trigger.
  - `[[startup]]` hooks run only on server start or live handoff. Config
    reload, client attach and plugin link/enable don't re-run them.
  - When edits to `herdr-plugin.toml` get re-read isn't documented. Assume you
    need to re-link or reload, and verify.
- **Plugin registration** lives in `~/.config/herdr/plugins.json`. You add one
  with `herdr plugin link <dir>`, which is idempotent.

## Josh's setup (read-only reference)

The repo is at `/Users/tom.george/git/josh_dotfiles` (`github.com/joshrwolf/dots`,
public). It's a GNU stow dotfiles repo; `make` builds the plugins, restows the
packages, then runs `herdr plugin link` on each one. **Don't modify it.** Read
it for reference only.

| Path | What it is |
|---|---|
| `herdr-plugins/` | Rust Cargo workspace: the plugin suite |
| `herdr-plugins/CLAUDE.md` | Josh's design rules for the suite. Read this first. |
| `herdr-plugins/crates/herdrkit/` | Shared Rust SDK, about 8k lines. **The main reference for our Go SDK.** |
| `herdr-plugins/contracts/` | Tests that check each manifest matches its dispatch and build wiring |
| `herdr/.config/herdr/config.toml` | His Herdr config: keybindings to plugin actions and panes, sidebar token rows |
| `nvim/.config/nvim/lua/herdr_review/` | Neovim half of the review plugin |
| `Makefile` | Targets `plugin-build-<name>` (cargo build + atomic rename into `<plugin>/bin/`), `plugins-link`, `check` |

### The plugins

| Plugin | Kind | What it does | Wiring in his config |
|---|---|---|---|
| `nav` | action ×4 | Ctrl+hjkl navigation shared across Herdr panes, vim splits and fzf. Makes one socket read and one action per keypress. | `ctrl+h/j/k/l` → `plugin_action herdr-nav.<dir>` |
| `find` | popup picker | One fuzzy list over workspaces, live agents, worktrees and zoxide dirs | `prefix+shift+p` → `herdr plugin pane open --plugin herdr-find --entrypoint picker` |
| `nvim` | action + popup + link handler | Opens a file in the nvim running in this tab, either from a picker (changed files first) or by clicking a `file://` OSC 8 link | `prefix+f` |
| `github` | background service + actions + panes + link handlers | CI and PR status published as sidebar tokens (`$gh_pr`, `$gh_state`, …), CI refresh and autofix, a CI brief pane, and opening PR/issue/Actions-run links in the browser. Its scheduler has a request budget, backoff and a rate-limit pause. State is kept in SQLite. | ci-fix, ci-refresh, ci-arm and ci-brief bindings |
| `review` | popup + Neovim integration + SQLite | Local, ongoing code review: review context → thread → message, plus requests dispatched to agents with recovery. The registry is stored at `<git common dir>/herdr-review/review.sqlite3`. | `prefix+r` |

Shared crates: `herdrkit` (SDK), `review-core` (review state machine),
`github-client`.

Architecture docs: `herdr-plugins/github/ARCHITECTURE.md` and
`herdr-plugins/review/ARCHITECTURE.md`.

## herdrkit: what to copy into Go

Read these files in `herdr-plugins/crates/herdrkit/src/`, in this order:

1. **`socket.rs`: transport.**
   - Newline-delimited JSON, with **one connection per request**. The server
     answers one request and closes the connection.
   - Each request type pairs its method name, result tag and reply type, so
     they can't drift apart.
   - Frames are capped at 8 MiB.
   - Every reply is checked for both request ID and result tag.
   - Deadlines: 3 s by default. Blocking calls get their own `timeout_ms` plus
     2 s of slack, so the server's timeout always fires first.
2. **`api.rs`: typed API.**
   - A hand-written subset of the API, pinned to `PROTOCOL = 22`.
   - Unknown fields are ignored on purpose; tests catch fields that disappear.
   - `Snapshot` helpers: `effective_workspace_dir`, `workspace_for_checkout`,
     `panes_in_tab`.
   - `agent_prompt_and_wait` does prompt + wait as one atomic server operation.
3. **`env.rs`: invocation context.**
   - Parses `HERDR_*` once into `InvocationKind::{Action, PaneEntrypoint, Startup, Event}`.
   - `classify()` is the exact rule to port: at most one of ACTION_ID,
     ENTRYPOINT_ID or EVENT may be set. `EVENT=startup` with no JSON, or
     nothing set, means Startup. Any other EVENT requires EVENT_JSON.
     Conflicting env is an error.
   - Empty env values count as unset.
4. **`events.rs`: change stream.**
   - The one long-lived connection.
   - Subscribing replays a stale backlog that has no sequence numbers. Treat
     each frame as "something changed", not as a record to act on. Reconcile
     once, then re-read the snapshot and diff on every wake-up.
5. **`metadata.rs` + `tokens.rs`: pushing values into Herdr's UI.**
   - Tokens are named per-workspace or per-pane values that the user's config
     renders by name (for example `$gh_pr` in the sidebar).
   - Limits: at most 16 tokens, names matching `^[A-Za-z0-9_-]{1,32}$`, TTL
     of at most 24 h.
   - Prefer a TTL, so a dead plugin's indicators fade instead of going stale.
6. **`testing.rs`: fake Herdr server** for tests. Scripted steps, owned
   fixtures.
7. **Later, not in v0.1:**
   - `service.rs`: background daemons with a server-scoped OS lock, readiness
     handshake, bounded control frames, backoff and owner/disable checks.
     Recovery is triggered by hooks, not by Herdr supervising the process.
     Never trust a caller's PID.
   - `picker/`: an in-process fuzzy TUI using nucleo + ratatui, written as a
     pure model.

Full list of `HERDR_*` env vars: `HERDR_SOCKET_PATH HERDR_PLUGIN_ID
HERDR_PLUGIN_ROOT HERDR_PLUGIN_STATE_DIR HERDR_PLUGIN_CONFIG_DIR
HERDR_CONFIG_PATH HERDR_PLUGIN_CONTEXT_JSON HERDR_WORKSPACE_ID HERDR_TAB_ID
HERDR_PANE_ID HERDR_PLUGIN_ACTION_ID HERDR_PLUGIN_ENTRYPOINT_ID
HERDR_PLUGIN_EVENT HERDR_PLUGIN_EVENT_JSON HERDR_PLUGIN_LINK_HANDLER_ID
HERDR_PLUGIN_CLICKED_URL HERDR_WORKTREE_TIMEOUT_SECS`. Popups have no
`HERDR_PANE_ID`.

## Decisions already made

- **Language: Go.** Gleam was ruled out because every plugin invocation spawns
  a new process, so VM or Node startup is too slow. That applies especially to
  `nav` on ctrl+hjkl and to the popup pickers, which have to own their own tty.
  Go builds a native binary with ms-level startup and has the libraries we
  need (Bubble Tea, fzf's matching algorithm, x/sys/unix, sqlite, go-github).
- **Types are hand-written, not generated.** The schema's `oneOf`-heavy
  structure generates poorly. We'll write the subset we use and add schema
  conformance tests against a saved copy of the schema.
- **Biggest Go pitfall:** Go silently zero-fills missing JSON fields. Every
  reply type needs a `validate()` method. Serde catches this in Rust, which is
  how herdrkit notices a removed field.
- **Scope:** v0.1 covers the client, env parsing, events and a fake server.
  The picker and services come later. See `HERDR_SDK.md` for phases and
  estimates (about 2–3 weeks part-time).

## Things to verify before building on them

These come from herdrkit's comments, not from the schema. Confirm each against
a live 0.9.1 server:

- The server answers one request per connection.
- `events.subscribe` replays a backlog.
- The blocking-call timeout behaviour.
- When manifest edits get picked up.

## Ground rules

- **Don't touch Herdr's live state while developing.** No
  `herdr server reload-config`, `plugin link` or `plugin install` without
  asking Tom. Josh's rules say the same thing.
- **No live captures in fixtures.** Don't commit snapshots, pane reads, logs
  or process listings from this machine. Write fixtures by hand with neutral
  names (`w1`, `gh:example/dots`, `/home/dev/src/...`).
- **Credit herdrkit.** It's MIT; credit it if design or doc text is carried
  over.
- **Go isn't installed yet.** Add it via nix first. The dotfiles use nix;
  see `nix/` here.

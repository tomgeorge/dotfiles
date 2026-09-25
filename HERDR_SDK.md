# Plan: a small Go SDK for Herdr

Goal: a Go module for writing Herdr plugins. It should give you a typed socket
client, invocation-context parsing, an event stream, and a fake server for
tests. Everything else (pickers, background services) is left for later.

Reference material:

- **Protocol spec:** `herdr api schema --json` (Herdr 0.9.1, `protocol: 22`,
  `schema_version: 1`, JSON Schema draft 2020-12).
- **Prior art:** `herdrkit` in a coworker's dotfiles (Rust). It is the
  reference for *semantics* the schema doesn't state: connection lifecycle,
  deadlines, event backlog behaviour, env var contract.

---

## 1. What the schema tells us

Top level: `.schemas.{request, success_response, error_response, event, subscription_event}`.

| Schema | Shape |
|---|---|
| `request` | `{ id: string, method: const, params: <XParams> }`. `oneOf` over **103 methods** |
| `success_response` | `{ id, result }`. `result` is `oneOf` over **~70 variants** tagged by `result.type` (`pong`, `session_snapshot`, `pane_list`, …, `ok`) |
| `error_response` | `{ id, error: { code: string, message: string } }` |
| `event` | `{ event: EventKind, data }`. 26 kinds, snake_case (`workspace_created`, `pane_agent_status_changed`, …) |
| `subscription_event` | `{ event, data }`. 3 kinds: `pane.output_matched`, `pane.agent_status_changed`, `pane.scroll_changed` |

Notable details:

- Request `id` is a **string**.
- Subscriptions are `{ "type": "workspace.created" }` style: dotted names,
  unlike the snake_case `EventKind` enum. Keep separate Go types for them.
- Blocking calls take `timeout_ms` (nullable uint64): `agent.wait`,
  `events.wait`, `pane.wait_for_output`, `agent.prompt` with `wait`.
- Metadata `tokens`: max 16, names match `^[A-Za-z0-9_-]{1,32}$`, values are
  string or null (null = clear). `ttl_ms` ranges from 1 to 86 400 000.
- Nullable fields are written `"type": ["string","null"]` or
  `anyOf: [ref, null]`.

### Semantics not in the schema (learned from herdrkit)

1. **One connection per request.** The server answers one non-subscription
   request and then closes. Never pipeline or pool connections.
2. **Newline-delimited JSON.** Cap frame size (herdrkit uses 8 MiB).
3. **Check both `id` and `result.type`** on every reply.
4. **Deadlines:** 3 s for ordinary calls. Blocking calls use
   `timeout_ms + 2 s slack` so the *server's* timeout fires first. A
   subscription has no read deadline.
5. **`events.subscribe` replays a backlog.** The backlog includes objects that
   no longer exist and has no sequence numbers. So an event means "something
   changed, go re-read the snapshot", not "act on this record".
6. **Env contract** (injected into every plugin process):
   `HERDR_SOCKET_PATH`, `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ROOT`,
   `HERDR_PLUGIN_STATE_DIR`, `HERDR_PLUGIN_CONFIG_DIR`, `HERDR_CONFIG_PATH`,
   `HERDR_PLUGIN_CONTEXT_JSON`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`,
   `HERDR_PANE_ID`, `HERDR_PLUGIN_ACTION_ID`, `HERDR_PLUGIN_ENTRYPOINT_ID`,
   `HERDR_PLUGIN_EVENT`, `HERDR_PLUGIN_EVENT_JSON`,
   `HERDR_PLUGIN_LINK_HANDLER_ID`, `HERDR_PLUGIN_CLICKED_URL`,
   `HERDR_WORKTREE_TIMEOUT_SECS`.
   Empty counts as unset.
7. **How an invocation is classified.** At most one of `ACTION_ID`,
   `ENTRYPOINT_ID` or `EVENT` may be set. If more than one is set, or
   `EVENT_JSON` is set without `EVENT`, that's an error.
   - `EVENT=startup` with no JSON, or nothing set at all → **Startup**.
   - Any other `EVENT` → **Event**, and `EVENT_JSON` is required.
   - Link-handler identity is independent of this classification.

Verify items 1, 4 and 5 against the live server early (see Phase 1). They came
from herdrkit's comments, not from the schema.

---

## 2. Design decisions

| Decision | Choice | Why |
|---|---|---|
| Generated vs hand-written | **Hand-written subset + a check against the schema** | The schema has ~100 `oneOf` variants. Go JSON Schema generators handle `oneOf` and discriminated unions badly. Writing only what we call keeps the API small. A conformance test catches drift. |
| API style | `ctx context.Context` first on every call | Idiomatic Go. Cancellation and deadlines come for free. |
| Transport | `net.Dialer.DialContext("unix", …)`, `bufio.Reader` with a size cap | Standard library only |
| Typed calls | Unexported generic `call[R any](ctx, c, method, tag string, params any) (R, error)` | Method, tag and reply type are paired in one place per public method, so they can't drift apart |
| IDs | `type WorkspaceID string`, `TabID`, `PaneID` | Stops IDs from being mixed up |
| Enums | `type AgentStatus string` + constants + `UnmarshalText` that maps unknown values to `AgentStatusUnknown` | Stands in for Rust's `#[serde(other)]` |
| Unknown fields | Ignored (Go's default) | A Herdr release that adds fields is a no-op |
| **Missing fields** | A `validate() error` method on every reply type, called by `call` | Go silently zero-fills missing fields. serde doesn't, and that's how herdrkit catches a removed field. This is the biggest correctness gap to close. |
| Nullable | Pointers (`*string`) or a small `Optional[T]` | Needed to tell "absent/null" apart from `""` |
| Errors | `*APIError{Method, Code, Message}`, plus sentinel errors `ErrWrongResult`, `ErrIDMismatch`, `ErrFrameTooLarge`, `ErrProtocol` | Callers can use `errors.As` / `errors.Is`. Wrap with `%w` at every boundary. |
| Dependencies | Standard library only, for the SDK itself. Tests may use `github.com/santhosh-tekuri/jsonschema/v6` (supports draft 2020-12). | Keeps the binary small and startup fast |

Target: Go ≥ 1.23. Go isn't on PATH on this machine yet, so add it via nix
first.

---

## 3. Package layout

```
herdr-go/
  go.mod                      module github.com/<you>/herdr-go
  schema/
    herdr-schema.json         vendored `herdr api schema --json` output
    README.md                 herdr version + protocol it was taken from
  herdr/                      package herdr — client + types
    client.go                 Client, New, FromEnv, transport, call[R]
    errors.go
    ids.go
    enums.go                  AgentStatus, Direction, Sound, …
    snapshot.go               Snapshot, Workspace, Tab, Pane + helpers
    workspace.go              workspace.* / worktree.* methods
    tab.go
    pane.go
    agent.go
    metadata.go               report_metadata + Tokens validation
    notify.go
    wait.go                   blocking calls (deadline = timeout + slack)
  plugin/                     package plugin — invocation context
    env.go                    Invocation, Kind (Action|PaneEntrypoint|Startup|Event)
  events/                     package events — subscriptions
    stream.go                 Subscribe, Next(ctx) ([]Change, error)
    subscription.go           Subscription types (dotted names)
  herdrtest/                  package herdrtest — scripted fake server
    server.go                 Unix listener in t.TempDir(); Step{Expect, Reply}
  examples/
    nav/main.go               ctrl+hjkl directional focus
    snapshot/main.go          dump workspaces/panes
```

---

## 4. Method scope (v0.1)

Only what plugins actually need. This covers roughly what herdrkit uses.

| Area | Methods | Result tags |
|---|---|---|
| Health | `ping` | `pong` |
| Session | `session.snapshot` | `session_snapshot` |
| Workspace | `workspace.list`, `workspace.get`, `workspace.create`, `workspace.focus`, `workspace.close`, `workspace.report_metadata` | `workspace_list`, `workspace_info`, `workspace_created`, `ok` |
| Worktree | `worktree.list`, `worktree.create`, `worktree.open`, `worktree.remove` | `worktree_*` |
| Tab | `tab.create`, `tab.focus`, `tab.close` | `tab_created`, `ok` |
| Pane | `pane.list`, `pane.get`, `pane.current`, `pane.read`, `pane.send_keys`, `pane.send_text`, `pane.neighbor`, `pane.focus_direction`, `pane.process_info`, `pane.report_metadata` | `pane_list`, `pane_info`, `pane_current`, `pane_read`, `pane_neighbor`, `pane_focus_direction`, `pane_process_info`, `ok` |
| Agent | `agent.list`, `agent.start`, `agent.focus`, `agent.prompt` (with and without `wait`), `agent.wait` | `agent_list`, `agent_started`, `agent_prompted`, `wait_matched`, `ok` |
| Wait | `pane.wait_for_output`, `events.wait` | `output_matched`, `wait_matched` |
| Events | `events.subscribe` | `subscription_started`, then stream frames |
| UI | `notification.show`, `plugin.pane.open` | `notification_show`, `plugin_pane_opened` |

For each method, read the exact `XParams` and result variant from the vendored
schema, e.g.:

```sh
jq '.schemas.request."$defs".PaneNeighborParams' schema/herdr-schema.json
jq '.schemas.success_response."$defs".ResponseResult.oneOf[]
    | select(.properties.type.const=="pane_neighbor")' schema/herdr-schema.json
```

Out of scope for v0.1: layout, graphics, copy mode, integrations,
plugin link/enable, agent views, server control.

---

## 5. Phases

### Phase 0: Setup (½ day)
- Add Go to the nix profile. `go mod init`.
- Vendor the schema. Add `make schema` to re-dump it, and a README line noting
  the Herdr version and protocol.
- golangci-lint with `errcheck`, `wrapcheck`, `exhaustive`, `nilaway` (or
  `nilnil`), `revive`, `gosec`.

### Phase 1: Transport + `ping` (1–2 days)
- `Client{socketPath string; dialTimeout time.Duration}`, `New(path)`, `FromEnv()`.
- `call[R]`: dial → write `{"id":…, "method":…, "params":…}\n` → read one
  frame (with cap and deadline) → decode an envelope with `id`, `result` and
  `error` as `json.RawMessage` → check the id → if there's an error, return
  `*APIError` → peek at `result.type`, error if it's not the expected tag →
  decode into R → `validate()`.
- IDs come from an `atomic.Uint64` combined with the pid (for example
  `"12345-7"`).
- Deadline: `min(ctx deadline, per-call default)`. Per-call default is 3 s, or
  `timeout_ms + 2s` for blocking calls.
- **Check against the live server:** that a second request on the same
  connection isn't answered, and that `ping` returns `protocol == 22`. Warn if
  the protocol differs from the one we compiled against.

### Phase 2: Core types + read methods (2–3 days)
- Snapshot, Workspace, Tab, Pane, Agent, Worktree, ProcessInfo, from the schema.
- Helpers:
  - `Snapshot.Workspace(id)`
  - `PanesInTab(tab)`
  - `WorkspaceForCheckout(path)`
  - `EffectiveWorkspaceDir(ws)`: prefer the checkout path, then the pane cwd,
    then the workspace cwd. Match herdrkit's rule exactly.
- `validate()` on every type.

### Phase 3: Mutations + blocking calls (2 days)
- The remaining v0.1 methods.
- `AgentPromptAndWait(ctx, target, text, until, timeout)`: a single
  `agent.prompt` call with `wait` set, so submit-and-settle is atomic on the
  server.
- `Tokens` type that validates count and name pattern *before* sending.
  `ReportMetadata` requires an explicit TTL choice (`Retained()` or
  `WithTTL(d)`).

### Phase 4: `plugin` package (1 day)
- `plugin.FromEnv() (Invocation, error)` follows the rules in §1.7 exactly.
  Reject conflicting or incomplete env before any side effects.
- Decode `HERDR_PLUGIN_CONTEXT_JSON` using `PluginInvocationContext` from the
  schema.
- `Invocation.Kind` is a sealed interface: `Action{ID}`,
  `PaneEntrypoint{ID}`, `Startup{}`, `Event{Name, Payload json.RawMessage}`.
  Use a type switch plus the `exhaustive` linter.
- Table tests for every combination.

### Phase 5: Events (2 days)
- `events.Subscribe(ctx, c, subs...) (*Stream, error)`. This is the one
  long-lived connection. Read the `subscription_started` ack, then frames.
- `Stream.Next(ctx) ([]Change, error)`. It blocks until there's a frame, then
  drains whatever else is already buffered and returns it as one batch. It
  returns an empty batch with no error on an idle timeout, so callers can use
  it as a tick.
- Document the pattern: reconcile once, then loop over re-reading the
  snapshot. Handle both `event` and `subscription_event` frame shapes.

### Phase 6: `herdrtest` fake server (1–2 days)
- `herdrtest.New(t, steps...)` listens on a socket in `t.TempDir()` and serves
  one step per connection. Each step says which `method` to expect and gives
  either a reply or raw bytes (for malformed, oversized or wrong-tag cases).
  `t.Cleanup` asserts that every step was used.
- Fixtures are **hand-written** with neutral names (`w1`, `gh:example/dots`,
  `/home/dev/src/…`). Never commit a live `session.snapshot` capture.

### Phase 7: Schema conformance tests (1 day)
This is what catches drift:
- Marshal every request the SDK can build and validate it against
  `schemas.request`.
- Validate every fixture reply against `schemas.success_response`.
- Walk the schema and assert that every method and result tag the SDK uses
  still exists.
- When Herdr is upgraded: `make schema && go test ./...`.

### Phase 8: Examples + release (1 day)
- `examples/nav`: read the current pane, call `pane.neighbor`, then either
  `pane.focus_direction` or send the keys on to vim. Measure its startup time
  (`hyperfine`) against the Rust `herdr-nav`.
- Tag v0.1.0.

**Total: about 2–3 weeks** part-time for v0.1.

---

## 6. Later (not in v0.1)

- **Picker:** Bubble Tea + Lip Gloss, with matching from
  `github.com/junegunn/fzf/src/algo`. Keep the model a pure function of
  (items, query, cursor, width), with match text separate from display text
  and support for rows that can't be selected.
- **Services:** background daemons with a server-scoped `flock`, a readiness
  handshake over a control socket, backoff, and owner checks. Re-exec with
  `os.Executable()` and an env marker. Never trust a caller's PID.
- **Codegen:** if the hand-written subset grows past ~40 methods, generate
  params/result structs from the schema with a small custom generator. Off-the-shelf
  generators handle this schema's `oneOf` + `const` tag pattern poorly.

---

## 7. Risks / open questions

- **Behaviour the schema doesn't state** (items 1, 4, 5, 7 in §1) comes from
  herdrkit. Verify it against 0.9.1 before building on it.
- **Protocol changes:** decide whether a `ping` protocol mismatch is a warning
  or a hard error. Recommendation: warn, and let the conformance tests be the
  real gate.
- **Missing-field validation** is manual work. Skipping `validate()` on a type
  means silent zero values.
- **Licensing:** herdrkit is MIT. Credit it if any design or doc text is
  carried over.
- **Fixtures:** don't commit captured output from a live Herdr (snapshots,
  pane reads, logs). Write them by hand.

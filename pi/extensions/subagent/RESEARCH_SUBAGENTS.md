# Research: how popular Pi subagent extensions work

This compares popular Pi subagent packages on background jobs, parallel jobs,
and steering running subagents. Those are the features we want to add to
our own `subagent` extension.

## Method

- **Ranking:** the [pi.dev package gallery](https://pi.dev/packages) sorted by
  downloads, plus an npm registry search for packages mentioning "subagent",
  ranked by npm monthly downloads (September 2026). Web search was unavailable:
  there's no Brave API key, and DuckDuckGo rate-limited every query.
- **Excluded:** the `@deepseek-ai/dsh-subagent*` packages (about 1.4M
  downloads/month each). They belong to DeepSeek Harness, a different agent
  harness, not Pi.
- **Analysis:** I shallow-cloned each repository into
  `/tmp/pi-subagent-research` and had one read-only subagent analyse each.
  Their reports cite files and lines. I spot-checked key claims (delivery
  flags, steer calls, child flags) against the source; the rest are the
  subagents' readings.

## Packages

| Package | Downloads/mo | Commit | Runs children as | Background | Steering |
| --- | --- | --- | --- | --- | --- |
| [`pi-subagents`](https://github.com/nicobailon/pi-subagents) (nicobailon) | ~455K | `2e9c51b` | Detached runner process; children in-process in the runner | Yes | Yes (user and parent), file inbox |
| [`pi-background-tasks`](https://github.com/ismailsaleekh/pi-background-tasks) | ~103K | `db01622` | Child `pi --mode text --print`, prompt over stdin | Yes | No |
| [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) | ~38K | `e955e29` | In-process SDK session | Yes (default) | Yes (user and parent), `session.steer()` |
| [`@quintinshaw/pi-dynamic-workflows`](https://github.com/QuintinShaw/pi-dynamic-workflows) | ~33K | `4b3027b` | In-process SDK session | Yes (default) | No |
| [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages) | ~12K | `629a174` | In-process SDK session | Yes (optional) | Parent only, `steer_subagent` tool |
| [`@agimon-ai/doompi-team`](https://github.com/AgiFlow/doompi) | ~6K | `4eca743` | In-process SDK (default), or detached CLI process | Only mode | Yes, plus peer-to-peer "intercom" |

## Findings

### 1. Background jobs share one delivery pattern

Every package with background jobs returns from the tool call right away with
a job ID, then wakes the parent when the job finishes:

```ts
pi.sendMessage({ customType, content, display: true }, { deliverAs: "followUp", triggerTurn: true });
```

- tintinweb: `src/index.ts:484`, `:522`
- gotgenes: `src/observation/notification.ts`
- pi-background-tasks: `src/extension.ts:260`. `triggerOnCompletion: false`
  delivers the result without waking the parent.
- nicobailon uses `triggerTurn: true` too (`notify.ts`).

`deliverAs: "followUp"` waits until the parent has no more tool calls, so a
result doesn't interrupt a turn in progress. `triggerTurn: true` starts a new
parent turn if the parent is idle.

### 2. Handling several results finishing close together

A naive implementation wakes the parent once per finished job, so three jobs
produce three parent turns. The mature packages avoid this:

- **Batching:** tintinweb's `GroupJoinManager` merges results from one
  parallel fan-out into a single message, with a 30-second window.
  nicobailon (`completion-batcher.ts`) and doompi (`CompletionBatcher`) also
  batch, but doompi sends failures immediately.
- **Withholding while busy:** gotgenes holds completion messages while the
  parent is mid-run and flushes them when the run ends
  (`notification.ts:258–290`, driven by `agent_start` and `agent_settled`).
- **No duplicates:** if the parent already fetched a result with a result
  tool, tintinweb (`resultConsumed`, a 200 ms hold) and gotgenes
  (claim/consume) skip the completion message.

### 3. Waiting on purpose is still available

Background by default, but the parent can wait when it needs a result
before continuing:

- tintinweb and gotgenes: `get_subagent_result { wait: true }`.
- nicobailon: a `bg_wait` tool. `{ nonBlocking: true }` registers a wake-up
  instead of blocking.
- doompi: `subagent({ action: "wait" })` polls about every 250 ms, with wait
  modes `completion`, `attention`, or `any`.
- tintinweb, gotgenes, and dynamic-workflows also offer a foreground
  (blocking) mode.

### 4. Large results: preview in the message, full text on request

The completion message holds a preview or metadata, and the parent fetches
the full output with a tool (tintinweb `get_subagent_result`,
background-tasks `bg_result`). pi-background-tasks' `autoDeliver: "when_small"`
puts answers up to 48 KiB in the message, saving that round trip.

### 5. Steering

| Package | Mechanism | Who can steer |
| --- | --- | --- |
| tintinweb | `AgentSession.steer()` on the in-process session. Steers sent before the session starts are buffered in `pendingSteers`. | Parent (`steer_subagent` tool), user (`/agents` UI), nested children |
| gotgenes | `steer_subagent` tool. Returns `buffered` or `delivered`. | Parent only |
| nicobailon | File inbox: JSON files in `<asyncDir>/control/steer-requests/`, watched by the runner. Mode `steer`, `follow_up`, or `auto`. Queue limit of 20, and the oldest entries are dropped silently. | Parent (`subagent` tool, `action: "steer"`), user (`s` in the fleet view) |
| doompi | `steer` action, plus an `intercom` tool with `send`, `ask`/`reply` (blocking, with a timeout), and `members` between named agents | Parent and subagents, peer-to-peer |
| background-tasks, dynamic-workflows | Not supported; the task is fixed at launch | — |

Steering is delivered after the child's current tool calls and before its
next model call. Pi's `steer` semantics are the same in the SDK and in RPC
mode.

### 6. Execution model trade-off

Four of six run children **in-process** with `createAgentSession()`. That's
cheap (no process start-up), and steering is a method call. But a child
shares the parent's memory, event loop, and crash domain, and isolation
(tools, extensions, context files) depends on how the session is configured.

The two child-process packages show the cost of process isolation:
- **pi-background-tasks** runs `--print`, so it can't steer.
- **nicobailon** added a detached runner and a file-based control channel
  just to steer across process boundaries. It chose files over signals
  partly because signals don't work well on Windows.

None of the surveyed packages runs children in **`pi --mode rpc`** and
steers with RPC's built-in `steer` command. That route keeps our process
isolation and needs no custom channel. I checked that a child starts in RPC
mode with our isolation flags and the Anthropic auth extension, but haven't
run a full task through it.

### 7. Limits, timeouts, and UI

- **Concurrency limits:** tintinweb 10 (background pool; foreground
  unlimited), gotgenes 4, dynamic-workflows 8 (hard cap 16), nicobailon 20.
  pi-background-tasks has none. Most **queue** jobs over the limit; we fail
  fast.
- **Timeouts:** tintinweb and gotgenes have **no wall-clock timeout**, only
  turn limits. tintinweb steers "wrap up now" at `maxTurns`, then aborts
  after 5 grace turns, which is a neat soft landing. background-tasks
  defaults to 20 minutes, and nicobailon to 30 minutes per run. Ours is 5
  minutes, which is short for background jobs.
- **UI:** almost all use a widget above the editor with braille spinners and
  elapsed time, like ours. The richer ones add the current tool, token or
  cost counts, and a `/agents`-style manager for viewing transcripts,
  stopping jobs, and steering.

## Pitfalls reported

- nicobailon: the steer queue drops entries silently; runner discovery has
  many fallback paths that fail only at launch.
- tintinweb and gotgenes: no wall-clock timeout, so a stuck agent runs until
  it hits its turn limit.
- tintinweb: nested children take no concurrency slot, so fan-out under
  them is unbounded.
- pi-background-tasks: live delegates don't survive reload; they're
  orphaned while their artifacts remain on disk.
- dynamic-workflows: patches `AgentSession.prototype` to deliver into the
  right session. The report called this fragile across SDK versions.

## What this suggests for our extension

1. **Background by default:** return `started <label> (#id)` right away.
   Deliver results with `pi.sendMessage(..., { deliverAs: "followUp",
   triggerTurn: true })`.
2. **Batch or withhold completions:** hold completion messages while the
   parent is mid-run and flush them together when it settles (gotgenes), so
   N parallel jobs wake the parent once.
3. **Wait tool:** a `subagent_result { label, wait? }` tool for when the
   parent needs a result before continuing. Skip the completion message if
   the result was already fetched.
4. **Steering with RPC mode:** switch the runner from `-p --mode json` to
   `--mode rpc`. Send `prompt`, then `steer` for steering and `abort` for a
   clean cancel. Keep SIGTERM/SIGKILL as a fallback. Buffer steers sent
   before the child is ready (tintinweb's `pendingSteers`). Expose steering
   to both the user (`/subagent-steer <label> <message>`) and the parent (a
   `subagent_steer` tool).
5. **Timeouts:** raise or restructure the 5-minute limit for background
   jobs. Consider tintinweb's soft landing: steer "wrap up" before killing.

These still need decisions (see the open questions in the chat): whether a
completion wakes the parent immediately, whether to keep a blocking mode,
and whether steering restarts the timeout.

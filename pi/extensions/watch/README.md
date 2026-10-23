# watch

Background watches and loops for Pi: "tell me when CI finishes", "did my
service deploy?", "watch this alert". A shell check runs locally on an interval
and the model is woken only when its condition holds, so waiting costs no tokens.

## Install

`link.sh` links this directory to `~/.pi/agent/extensions/watch`. For just this
extension:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi/extensions/watch" ~/.pi/agent/extensions/watch
```

Run `/reload` in Pi afterward, or try it once with `pi -e ./pi/extensions/watch`.

## Use

Ask in plain language and the model starts a watch with the `watch` tool:

```text
tell me when the CI checks on this PR finish
let me know when api is rolled out in staging
watch the payments-5xx alert and ping me if it changes, but don't interrupt me
```

Or start one yourself:

```text
/watch gh pr checks 123; test $? -ne 8
/watch 1m --timeout 30m kubectl rollout status deploy/api -n staging --timeout=50s
/watch 2m --change --notify gcloud alpha monitoring policies describe POLICY --format='value(enabled)'
/loop 15m check #incidents in Slack for anything about payments
/watches            # browse watches and loops (also ctrl+shift+w)
/unwatch 2          # stop #2; no id stops all
```

Leading options: an interval (`30s`, `5m`), `--timeout DUR`, and for `/watch`
`--change` and `--wake`/`--steer`/`--notify`. Use `--` before a command that
starts with one of these.

### Panel

While watches are active, a widget below the input box lists them, one row each
(up to five, then `+N more`):

```text
─ Watches · 1 watching · 1 loop ─────────────────────────── ctrl+shift+w ─
 ◷  #1  watch  CI for PR 123      3 checks  exit 8  next in 25s
 ●  #2  loop   slack incidents      2 runs          due when idle
```

`◷` waits for its next check, a spinner means a check is running, and `●` is a
loop iteration waiting for Pi to go idle.

`ctrl+shift+w` or `/watches` opens the shared panel ([`run-panel`](../run-panel/)),
with the crew panel's layout and keys: watches on the left (stacked above the
details below 100 columns), and the selected one's details in three tabs:

1. **Overview**: kind and mode, cwd, interval, timeout and time left, counts,
   status, and the whole command or prompt.
2. **Log**: the timestamped event log. Identical consecutive checks collapse into
   one line (`×12`). It follows new entries; `k` or `ctrl+u` pauses and `G`
   follows again.
3. **Output**: the last check's stdout and stderr, or a loop's prompt, with the
   error first when the watch ended in one.

Ended watches stay listed for the session (the last 50), with how they ended.

| Key | Action |
|---|---|
| type, `/` | Filter by id, kind, description, command or prompt, or status. `enter` keeps the filter, `esc` clears it |
| `j`/`k`, arrows | Move; in the details, scroll |
| `enter`, `l` / `h` | Focus the details / back to the list |
| `tab`/`shift+tab`, `1`-`3` | Switch tab |
| `g`/`G` | Top/bottom. On Log, `G` follows new entries again |
| `ctrl+d`/`ctrl+u` | Page the details, from either pane |
| `ctrl+o` | Zoom the details to the full panel |
| `x` | Stop the selected watch or loop, at once (no confirmation) |
| `?` | Help |
| `esc` | Clear the filter, leave the details, leave zoom, then close |
| `q`, `ctrl+shift+w` | Close |

`ctrl+shift+w` needs a terminal that reports modifier keys (kitty keyboard
protocol); elsewhere use `/watches`. Without a UI, `/watches` prints the list.
The widget (`panel.ts`), the panel source (`source.ts`), and the session record
(`store.ts`) are separate from Pi so they can be tested with injected styling.

### Conditions

| `until` | Reports when | Ends when |
| --- | --- | --- |
| `success` (default) | the command exits 0 | it reports, or times out |
| `change` | stdout or the exit code differs from the previous check (the first check sets the baseline) | it times out or is stopped |

Write the check so exit 0 means the wait is over. `gh pr checks` exits 8 while
checks are pending, so `gh pr checks 123; test $? -ne 8` reports on pass *or*
fail. Commands that block until done, like `gh run watch --exit-status` or
`kubectl rollout status`, also work: a check may run until the watch's timeout.
Exit 126 or 127 (not executable, not found) stops the watch with an error.

The first check's result is shown right away, so a broken check (auth error,
typo, missing file) doesn't wait silently until the timeout. `/watch` shows it
as a notification, a warning if the check failed and wrote to stderr. The `watch`
tool waits up to 10s for it and returns it to the model. In `change` mode, the
first check is the baseline even if it fails: watching a file that doesn't exist
yet reports when it appears. Change reports say what changed from, e.g.
`Exit 0 (was exit 1)`.

Ids number the active watches: a new watch takes the lowest free number, so an
id is reused once its watch ends.

### Delivery

What happens when a watch reports:

| `deliver` | Agent idle | Agent busy |
| --- | --- | --- |
| `wake` (default) | starts a turn | lets the current run finish, then the model answers with both in context (Pi follow-up) |
| `steer` | starts a turn | injects the report into the current run |
| `notify` | shows the report; no turn | holds the report until the current run ends, then shows it; no turn |

Every report also raises a Pi notification and an OSC 777 desktop notification
(Ghostty, iTerm2, WezTerm; wrapped for tmux, which needs `allow-passthrough on`).
`notify` reports stay in the session, so the model sees them with your next prompt.

### Loops

`/loop` (or `watch` with `prompt`) sends the prompt to the model every interval,
like Claude Code's `/loop`. An iteration due during a run waits until Pi settles;
missed iterations don't pile up, and the next interval starts after delivery.
Each iteration costs a model turn, so prefer a command watch when a shell check
can decide. The model ends a loop with `watch_stop`.

### Limits and defaults

| | Command | Loop |
| --- | --- | --- |
| Interval | 30s (min 5s) | 10m (min 1m) |
| Timeout | 1h | 4h |

The timeout is at most 24h; at most 20 watches run at once. When a watch times
out or fails, it reports that through its delivery mode (loops use `notify`).

Watches are session-scoped and in memory: `/reload`, switching sessions, or
quitting stops them, and resuming doesn't restore them. Print mode (`pi -p`)
exits when the run ends, which stops any watch with it.

Command watches run with your permissions, unattended, through `bash -c` in the
session's working directory, like Pi's `bash` tool. Their output reaches the
model labeled untrusted, last 40 lines / 4 KB.

## Design notes

How other harnesses do this, and what this extension takes from each:

- **Claude Code `/loop`** re-runs a prompt on a cron schedule (`CronCreate`) or at
  a model-chosen delay (`ScheduleWakeup`). Fires only between turns, no catch-up.
  → `/loop`.
- **Claude Code Monitor** runs a background script and wakes the model on each
  output line, with a deadline. → command watches, but the extension evaluates
  the condition itself, so the model only hears about the outcome.
- **Codex CLI** keeps background terminals that the model polls with
  `write_stdin`; each poll is a full model request
  ([openai/codex#13733](https://github.com/openai/codex/issues/13733)). A
  proposed `wake_on_output` batches output, caps it, and labels it untrusted
  ([#29865](https://github.com/openai/codex/issues/29865)). → local checks,
  capped untrusted output.

## Test

```sh
node --test pi/extensions/watch/*.test.ts
```

The shared helpers and the panel come from [`run-panel`](../run-panel/), imported by
relative path; Pi resolves imports from the symlink's real path, so this works
although each extension is linked on its own.

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
/watches            # list; pick one to stop it
/unwatch 2          # stop #2; no id stops all
```

Leading options: an interval (`30s`, `5m`), `--timeout DUR`, and for `/watch`
`--change` and `--wake`/`--steer`/`--notify`. Use `--` before a command that
starts with one of these.

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

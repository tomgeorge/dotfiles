#!/usr/bin/env bash
# Headless /checkin. Silent unless something needs attention: then it saves the
# result and raises one notification. Run by launchd (nix/modules/features/pi-checkin.nix)
# or by hand: pi/checkin/run.sh
set -euo pipefail
# Mail and task summaries are private.
umask 077

state="$HOME/.local/state/pi-checkin"
mkdir -p "$state"
chmod 700 "$state"
log="$state/runs.log"
model="${PI_CHECKIN_MODEL:-anthropic/claude-sonnet-5-5}"
# A stalled provider or MCP server must not hang the job: launchd won't start
# the next scheduled run while this one is still alive.
deadline="${PI_CHECKIN_TIMEOUT:-300}"

# Read-only by construction: no shell, file-writing, or command-running tools
# (watch runs shell checks; subagent spawns processes). MCP stays reachable through
# codemode, and print mode has no UI, so mcp-confirm blocks every MCP call not marked
# or allowlisted read-only. The agent prints a STATE line; this script saves it.
no_tools="bash,edit,write,watch,watch_list,watch_stop,subagent"
rc=0
out=$(cd "$HOME" && timeout --kill-after=10 "$deadline" \
  pi -p --no-session --exclude-tools "$no_tools" --model "$model" "/checkin" 2>>"$log") || rc=$?
if [ "$rc" -ne 0 ]; then
  echo "$(date -Iseconds) pi failed (exit $rc$([ "$rc" -eq 124 ] && echo ", timed out after ${deadline}s"))" >>"$log"
  exit 1
fi

new_state=$(printf '%s\n' "$out" | sed -n 's/^STATE: //p' | tail -1)
out=$(printf '%s\n' "$out" | { grep -v '^STATE: ' || true; } | sed -e 's/[[:space:]]*$//' | sed -e '/./,$!d')
if [ -n "$new_state" ]; then
  if printf '%s' "$new_state" | jq -e 'type == "object" and has("reported")' >/dev/null 2>&1; then
    printf '%s\n' "$new_state" >"$state/reported.json"
  else
    echo "$(date -Iseconds) ignored malformed STATE line" >>"$log"
  fi
fi
echo "$(date -Iseconds) $(printf '%s' "$out" | head -c 200 | tr '\n' ' ')" >>"$log"

if [ -z "$out" ] || [ "$out" = "NO_REPLY" ]; then
  exit 0
fi

printf '%s\n\n(%s)\n' "$out" "$(date '+%a %H:%M')" >"$state/latest.md"
if [ "${PI_CHECKIN_NOTIFY:-1}" = "1" ] && command -v osascript >/dev/null; then
  # sed reads all input, so a long reply can't SIGPIPE the pipeline under pipefail.
  first=$(printf '%s\n' "$out" | sed -n '1{s/^• //;p;}' | tr -d '"\\')
  count=$(printf '%s\n' "$out" | grep -c '^•' || true)
  osascript -e "display notification \"$first\" with title \"Check-in: $count item(s)\" subtitle \"cat ~/.local/state/pi-checkin/latest.md\"" || true
fi

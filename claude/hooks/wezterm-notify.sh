#!/usr/bin/env bash
set -euo pipefail

# Called by Claude Code hooks (Notification + Stop events).
# Writes a JSON file that WezTerm polls to show tab badges.

PANE_ID="${WEZTERM_PANE:-}"
if [ -z "$PANE_ID" ]; then
  exit 0
fi

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null || echo "unknown")

case "$EVENT" in
  Notification)
    TYPE=$(echo "$INPUT" | jq -r '.notification_type // "unknown"' 2>/dev/null || echo "unknown")
    case "$TYPE" in
      idle_prompt)
        STATUS="waiting"
        MESSAGE="Claude needs input"
        ;;
      permission_prompt)
        STATUS="waiting"
        MESSAGE="Claude needs permission"
        ;;
      *)
        exit 0
        ;;
    esac
    ;;
  Stop)
    HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")
    if [ "$HOOK_ACTIVE" = "true" ]; then
      exit 0
    fi
    STATUS="done"
    MESSAGE="Claude finished"
    ;;
  *)
    exit 0
    ;;
esac

NOTIFY_DIR="/tmp/wezterm-notifications"
mkdir -p "$NOTIFY_DIR"

jq -n \
  --arg status "$STATUS" \
  --arg message "$MESSAGE" \
  --arg timestamp "$(date +%s)" \
  '{status: $status, message: $message, timestamp: ($timestamp | tonumber)}' \
  > "$NOTIFY_DIR/${PANE_ID}.json"

exit 0

#!/usr/bin/env bash
# Paints every workspace item: the focused one gets a mauve pill, ones with
# windows plain text, empty ones dimmed. workspace_changing carries dinky's
# target (DINKY_WORKSPACE) so the bar moves before the switch lands;
# workspace_change carries the real state (WORKSPACE). Anything else, such as
# focus_changed after a window moves or display_changed, asks dinky.

source "$CONFIG_DIR/colors.sh"

case "$SENDER" in
workspace_changing) focused=$DINKY_WORKSPACE ;;
workspace_change) focused=$WORKSPACE ;;
*) focused=$(dinky list-workspaces --focused 2>/dev/null) ;;
esac

occupied=" $(dinky list-workspaces --all --empty no 2>/dev/null | tr '\n' ' ') "

args=()
for ws in 1 2 3 4 5; do
  if [ "$ws" = "$focused" ]; then
    args+=(--set "workspace.$ws" background.drawing=on "label.color=$BASE")
  elif [[ $occupied == *" $ws "* ]]; then
    args+=(--set "workspace.$ws" background.drawing=off "label.color=$TEXT")
  else
    args+=(--set "workspace.$ws" background.drawing=off "label.color=$OVERLAY0")
  fi
done

sketchybar --animate tanh 8 "${args[@]}"

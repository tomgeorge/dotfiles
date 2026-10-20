#!/usr/bin/env bash
# Highlights workspace $1 when it's the focused one. workspace_changing carries
# dinky's target (DINKY_WORKSPACE) so the bar moves before the switch lands;
# workspace_change carries the real state (WORKSPACE). Anything else, such as
# sketchybar's own startup, asks dinky.

case "$SENDER" in
workspace_changing) focused=$DINKY_WORKSPACE ;;
workspace_change) focused=$WORKSPACE ;;
*) focused=$(dinky list-workspaces --focused 2>/dev/null) ;;
esac

if [ "$1" = "$focused" ]; then
  sketchybar --set "$NAME" background.drawing=on
else
  sketchybar --set "$NAME" background.drawing=off
fi

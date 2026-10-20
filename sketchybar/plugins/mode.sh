#!/usr/bin/env bash
# Shows dinky's binding mode, except the everyday `main` one.

mode=${MODE:-$(dinky list-modes --current 2>/dev/null)}

if [ -z "$mode" ] || [ "$mode" = main ]; then
  sketchybar --set "$NAME" drawing=off
else
  sketchybar --set "$NAME" drawing=on label="[$mode]"
fi

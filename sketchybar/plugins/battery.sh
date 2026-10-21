#!/usr/bin/env bash

source "$CONFIG_DIR/colors.sh"

status=$(pmset -g batt)
percent=$(grep -Eo '[0-9]+%' <<<"$status" | tr -d %)
[ -n "$percent" ] || exit 0

if grep -q 'AC Power' <<<"$status"; then
  icon=󰂄 color=$GREEN
elif [ "$percent" -ge 80 ]; then
  icon=󰁹 color=$GREEN
elif [ "$percent" -ge 50 ]; then
  icon=󰁾 color=$YELLOW
elif [ "$percent" -ge 20 ]; then
  icon=󰁻 color=$PEACH
else
  icon=󰂃 color=$RED
fi

sketchybar --set "$NAME" icon="$icon" icon.color=$color label="$percent%"

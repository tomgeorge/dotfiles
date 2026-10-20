#!/usr/bin/env bash

status=$(pmset -g batt)
percent=$(grep -Eo '[0-9]+%' <<<"$status" | tr -d %)
[ -n "$percent" ] || exit 0

if grep -q 'AC Power' <<<"$status"; then
  icon=󰂄
elif [ "$percent" -ge 80 ]; then
  icon=󰁹
elif [ "$percent" -ge 50 ]; then
  icon=󰁾
elif [ "$percent" -ge 20 ]; then
  icon=󰁻
else
  icon=󰂃
fi

sketchybar --set "$NAME" icon="$icon" label="$percent%"

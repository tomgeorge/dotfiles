#!/usr/bin/env bash
# front_app_switched passes the app's name as INFO; dinky's focus_changed
# doesn't, so ask dinky for the focused window's app then.

if [ "$SENDER" = front_app_switched ]; then
  app=$INFO
else
  app=$(dinky list-windows --focused --format '%{app-name}' 2>/dev/null)
fi

[ -n "$app" ] && sketchybar --set "$NAME" label="$app"

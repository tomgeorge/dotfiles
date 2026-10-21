#!/usr/bin/env bash
# Wi-Fi status. macOS 14.4+ redacts the SSID for apps without Location access,
# so fall back to the IP address when it comes back as <redacted>.
# `sudo ipconfig setverbose 1` un-redacts `ipconfig getsummary`.

source "$CONFIG_DIR/colors.sh"

iface=$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2; exit}')
iface=${iface:-en0}
ip=$(ipconfig getifaddr "$iface")

if [ -z "$ip" ]; then
  sketchybar --set "$NAME" icon=󰖪 icon.color=$RED label="off"
  exit 0
fi

ssid=$(ipconfig getsummary "$iface" | awk -F' : ' '/^ +SSID :/{print $2; exit}')
if [ -z "$ssid" ] || [ "$ssid" = "<redacted>" ]; then
  ssid=$ip
fi

sketchybar --set "$NAME" icon=󰖩 icon.color=$TEAL label="$ssid"

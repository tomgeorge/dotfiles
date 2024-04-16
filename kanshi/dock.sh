#!/bin/sh
LAPTOP_OUTPUT="eDP-1"
LID_STATE_FILE="/proc/acpi/button/lid/LID/state"

read -r LS < "$LID_STATE_FILE"

case "$LS" in
  *open) 
    swaymsg output "$LAPTOP_OUTPUT" enable
    kanshictl switch docked_lid_open
    notify-send "Lid open"
    ;;
  *closed) 
    swaymsg output "$LAPTOP_OUTPUT" disable
    kanshictl switch docked_lid_closed
    notify-send "Lid closed"
    ;;
esac

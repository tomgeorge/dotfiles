local wezterm = require("wezterm")

local M = {}

local NOTIFY_DIR = "/tmp/wezterm-notifications"
local POLL_INTERVAL_SECONDS = 2

local function read_notifications()
  local notifications = {}
  local ok, entries = pcall(wezterm.read_dir, NOTIFY_DIR)
  if not ok or not entries then
    return notifications
  end
  for _, path in ipairs(entries) do
    if path:match("%.json$") then
      local f = io.open(path, "r")
      if f then
        local content = f:read("*a")
        f:close()
        local parse_ok, data = pcall(wezterm.json_parse, content)
        if parse_ok and data then
          local pane_id = path:match("/(%d+)%.json$")
          if pane_id then
            notifications[pane_id] = data
          end
        end
      end
    end
  end
  return notifications
end

local function clear_notification(pane_id)
  os.remove(NOTIFY_DIR .. "/" .. tostring(pane_id) .. ".json")
end

function M.apply_to_config(config)
  if not wezterm.GLOBAL.claude_notifications then
    wezterm.GLOBAL.claude_notifications = {}
  end
  if not wezterm.GLOBAL.claude_notified_timestamps then
    wezterm.GLOBAL.claude_notified_timestamps = {}
  end

  -- Poll for notification files
  wezterm.time.call_after(1, function()
    local function poll()
      local notifications = read_notifications()
      wezterm.GLOBAL.claude_notifications = notifications

      -- Fire toast for new notifications
      local notified = wezterm.GLOBAL.claude_notified_timestamps or {}
      for pane_id, data in pairs(notifications) do
        local prev_ts = notified[pane_id]
        if not prev_ts or prev_ts ~= data.timestamp then
          notified[pane_id] = data.timestamp
          -- Toast via mux window (best effort)
          for _, w in ipairs(wezterm.gui.gui_windows()) do
            local msg = data.message or ("Claude " .. data.status)
            w:toast_notification("Claude Code", msg, nil, 4000)
            break
          end
        end
      end
      wezterm.GLOBAL.claude_notified_timestamps = notified

      wezterm.time.call_after(POLL_INTERVAL_SECONDS, poll)
    end
    poll()
  end)

  -- Tab title badges
  wezterm.on("format-tab-title", function(tab)
    local notifications = wezterm.GLOBAL.claude_notifications or {}

    -- Check all panes in the tab
    local data = nil
    for _, p in ipairs(tab.panes) do
      data = notifications[tostring(p.pane_id)]
      if data then break end
    end

    if not data then return nil end

    local title = tab.active_pane.title
    local badge, bg
    if data.status == "waiting" then
      badge = " [WAIT]"
      bg = "#e5c890"
    elseif data.status == "done" then
      badge = " [DONE]"
      bg = "#a6d189"
    else
      return nil
    end

    return {
      { Background = { Color = bg } },
      { Foreground = { Color = "#303446" } },
      { Text = " " .. title .. badge .. " " },
    }
  end)

  -- Status bar unread count + auto-clear active pane
  wezterm.on("update-status", function(window, pane)
    local notifications = wezterm.GLOBAL.claude_notifications or {}

    -- Auto-clear if active pane has a notification
    local active_id = tostring(pane:pane_id())
    if notifications[active_id] then
      clear_notification(active_id)
      notifications[active_id] = nil
      wezterm.GLOBAL.claude_notifications = notifications
    end

    local unread = 0
    for _ in pairs(notifications) do
      unread = unread + 1
    end

    if unread > 0 then
      window:set_right_status(wezterm.format({
        { Foreground = { Color = "#e5c890" } },
        { Text = string.format(" %d ", unread) },
      }))
    else
      window:set_right_status("")
    end
  end)

  -- Leader+n: jump to next notifying pane
  table.insert(config.keys, {
    key = "n",
    mods = "LEADER",
    action = wezterm.action_callback(function(window, pane)
      local notifications = wezterm.GLOBAL.claude_notifications or {}
      for pane_id in pairs(notifications) do
        local target_id = tonumber(pane_id)
        if target_id then
          -- Search all tabs in the window
          for _, t in ipairs(window:mux_window():tabs()) do
            for _, p in ipairs(t:panes()) do
              if p:pane_id() == target_id then
                t:activate()
                p:activate()
                clear_notification(pane_id)
                notifications[pane_id] = nil
                wezterm.GLOBAL.claude_notifications = notifications
                return
              end
            end
          end
        end
      end
    end),
  })
end

return M

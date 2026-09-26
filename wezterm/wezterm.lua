local wezterm = require("wezterm")
local act = wezterm.action
local notifications = require("notifications")
local nav = require("nav")

local config = {
	color_scheme = "Catppuccin Frappe",
	-- color_scheme = "Everforest Dark Medium (Gogh)",
	-- font = wezterm.font("JetBrains Mono"),
	-- font = wezterm.font("Fira Code Nerd Font"),
	font = wezterm.font("DejaVu Sans Mono"),
	-- font_size = 18,
	font_size = 14,
	term = "wezterm",
	enable_kitty_graphics = true,
	default_prog = { "/etc/profiles/per-user/" .. os.getenv("USER") .. "/bin/fish", "-l" },
	window_background_opacity = 0.9,
	window_decorations = "RESIZE",
	text_background_opacity = 0.9,
	tab_bar_at_bottom = true,
	use_fancy_tab_bar = false,
}

-- ctrl+a is the leader unless herdr is in front (see nav.lua); these run
-- from a one-shot key table after it.
local leader_keys = {
	-- Send ctrl+a when you press it twice
	{ key = "a", mods = "CTRL", action = act.SendKey({ key = "a", mods = "CTRL" }) },

	-- Window navigation
	{ key = "'", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },
	{ key = "%", mods = "SHIFT", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
	{ key = "h", action = act.ActivatePaneDirection("Left") },
	{ key = "j", action = act.ActivatePaneDirection("Down") },
	{ key = "k", action = act.ActivatePaneDirection("Up") },
	{ key = "l", action = act.ActivatePaneDirection("Right") },
	{ key = "x", action = act.CloseCurrentPane({ confirm = true }) },
	{ key = "o", action = act.TogglePaneZoomState },
	{ key = "c", action = act.SpawnTab("CurrentPaneDomain") },
	{ key = "]", action = act.ActivateTabRelative(1) },
	{ key = "[", action = act.ActivateTabRelative(-1) },
	{ key = "r", action = act.ReloadConfiguration },
	{ key = "y", action = act.QuickSelect },
}

nav.apply_to_config(config, leader_keys)
notifications.apply_to_config(config)

wezterm.on("window-config-reloaded", function(window, pane)
	window:toast_notification("wezterm", "configuration reloaded!!!", nil, 4000)
	-- window:set_left_status(wezterm.format({
	-- 	{ Foreground = { Color = "#a6d189" } },
	-- 	{ Text = " Config reloaded! " },
	-- }))
	-- wezterm.time.call_after(4, function()
	-- 	window:set_left_status("")
	-- end)
end)

return config

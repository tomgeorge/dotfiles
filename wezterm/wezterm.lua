local wezterm = require("wezterm")
local act = wezterm.action

return {
	color_scheme = "nord",
	font = wezterm.font("SauceCodePro NerdFont"),
	font_size = 11,
	window_background_opacity = 1,
	text_background_opacity = 1,
	tab_bar_at_bottom = true,
	use_fancy_tab_bar = false,
	leader = { key = "a", mods = "CTRL" },
	keys = {
		-- Send ctrl+a when you press it twice
		{ key = "a", mods = "LEADER|CTRL", action = act.SendKey({ key = "a", mods = "CTRL" }) },

		-- Window navigation
		{ key = "'", mods = "LEADER", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },
		{ key = "%", mods = "LEADER|SHIFT", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
		{ key = "h", mods = "LEADER", action = act.ActivatePaneDirection("Left") },
		{ key = "j", mods = "LEADER", action = act.ActivatePaneDirection("Down") },
		{ key = "k", mods = "LEADER", action = act.ActivatePaneDirection("Up") },
		{ key = "l", mods = "LEADER", action = act.ActivatePaneDirection("Right") },
		{ key = "x", mods = "LEADER", action = act.CloseCurrentPane({ confirm = true }) },
		{ key = "o", mods = "LEADER", action = act.TogglePaneZoomState },
		{ key = "c", mods = "LEADER", action = act.SpawnTab("CurrentPaneDomain") },
		{ key = "]", mods = "LEADER", action = act.ActivateTabRelative(1) },
		{ key = "[", mods = "LEADER", action = act.ActivateTabRelative(-1) },
	},
}

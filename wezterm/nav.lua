-- ctrl+hjkl and the ctrl+a leader, shared with herdr and nvim (NAV_PLAN.md).
-- When herdr or vim is in front, the key goes to it: they move focus
-- themselves and hand back to WezTerm at their edges (herdr-nav).
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Same list as go-herdrkit's AcceptsVimNavigation.
local vim_names = {
	vi = true,
	vim = true,
	vimdiff = true,
	view = true,
	ex = true,
	rvim = true,
	rview = true,
	evim = true,
	eview = true,
	nvi = true,
	nvim = true,
	nvimdiff = true,
}

-- normalize turns "/nix/store/…/bin/NVIM.exe" into "nvim".
function M.normalize(path)
	local name = (path or ""):match("([^/\\]+)$") or ""
	name = name:lower():gsub("%.exe$", "")
	return name
end

function M.accepts_vim_navigation(name)
	return vim_names[name] == true or name:match("^vim%.[%w_]+$") ~= nil
end

-- Programs that carry a pane to another host, where WezTerm can't see what
-- runs. nvim there says it's in front with the tg_nav_vim user var
-- (nvim/lua/nav.lua). Only trusted while one of these is in front: if the
-- connection drops, the var is left over but the local shell is in front.
local remote_names = { ssh = true, mosh = true, ["mosh-client"] = true, et = true }

-- front is "herdr" or "vim" when that program is in the pane's foreground,
-- else nil.
function M.front(pane)
	local name = M.normalize(pane:get_foreground_process_name())
	if name == "herdr" then
		return "herdr"
	end
	if M.accepts_vim_navigation(name) then
		return "vim"
	end
	if remote_names[name] and (pane:get_user_vars() or {}).tg_nav_vim == "1" then
		return "vim"
	end
	return nil
end

local edge_dirs = { left = "Left", down = "Down", up = "Up", right = "Right" }

-- on_user_var handles nvim outside herdr (here or over ssh) at its edge: it
-- sets tg_nav_edge to "<direction>:<counter>" and WezTerm moves on for it.
function M.on_user_var(window, pane, name, value)
	if name ~= "tg_nav_edge" then
		return
	end
	local dir = edge_dirs[(value or ""):match("^(%a+):")]
	if dir then
		window:perform_action(act.ActivatePaneDirection(dir), pane)
	end
end

M.directions = {
	{ key = "h", dir = "Left" },
	{ key = "j", dir = "Down" },
	{ key = "k", dir = "Up" },
	{ key = "l", dir = "Right" },
}

function M.nav_action(pane, key, dir)
	if M.front(pane) then
		return act.SendKey({ key = key, mods = "CTRL" })
	end
	return act.ActivatePaneDirection(dir)
end

-- herdr uses ctrl+a as its prefix too; when it's in front it gets the key,
-- and its own ]/[ hand off to WezTerm's tabs past its last/first tab.
function M.leader_action(pane)
	if M.front(pane) == "herdr" then
		return act.SendKey({ key = "a", mods = "CTRL" })
	end
	return act.ActivateKeyTable({ name = "leader", one_shot = true, timeout_milliseconds = 1000 })
end

-- tab_action moves one tab. herdr gets its own prefix+]/[ (tg.nav), which
-- hands off to WezTerm's tabs past its last/first tab; a raw ctrl+[ would
-- reach herdr as Esc.
function M.tab_action(pane, key, delta)
	if M.front(pane) == "herdr" then
		return act.Multiple({
			act.SendKey({ key = "a", mods = "CTRL" }),
			act.SendKey({ key = key }),
		})
	end
	return act.ActivateTabRelative(delta)
end

M.tabs = {
	{ key = "]", delta = 1 },
	{ key = "[", delta = -1 },
}

-- perform binds a key to whatever action choose(pane) picks at press time.
local function perform(choose)
	return wezterm.action_callback(function(window, pane)
		window:perform_action(choose(pane), pane)
	end)
end

-- apply_to_config binds ctrl+a (to leader_keys, a one-shot key table, when
-- herdr isn't in front), ctrl+hjkl and cmd+]/[, and handles nvim's edge
-- user var.
function M.apply_to_config(config, leader_keys)
	config.keys = config.keys or {}
	config.key_tables = config.key_tables or {}
	config.key_tables.leader = leader_keys
	wezterm.on("user-var-changed", M.on_user_var)
	table.insert(config.keys, { key = "a", mods = "CTRL", action = perform(M.leader_action) })
	for _, d in ipairs(M.directions) do
		local function choose(pane)
			return M.nav_action(pane, d.key, d.dir)
		end
		table.insert(config.keys, { key = d.key, mods = "CTRL", action = perform(choose) })
	end
	for _, t in ipairs(M.tabs) do
		local function choose(pane)
			return M.tab_action(pane, t.key, t.delta)
		end
		table.insert(config.keys, { key = t.key, mods = "SUPER", action = perform(choose) })
	end
end

return M

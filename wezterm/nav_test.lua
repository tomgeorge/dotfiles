-- Run: nvim --headless -u NONE -l wezterm/nav_test.lua
-- WezTerm's GUI can't be driven headlessly, so this stubs the wezterm module
-- and checks which action each key resolves to.
local dir = debug.getinfo(1, "S").source:match("^@(.*)/[^/]*$") or "."

-- Actions become { name, arg } so tests can compare them.
package.loaded.wezterm = {
	action = setmetatable({}, {
		__index = function(_, name)
			return function(arg)
				return { name, arg }
			end
		end,
	}),
	action_callback = function(fn)
		return { "callback", fn }
	end,
}
-- By path, not require: nvim searches its runtimepath first, where
-- ~/.config/nvim/lua/nav.lua (nvim's own nav module) would win.
local nav = dofile(dir .. "/nav.lua")

local failures = 0
local function eq(got, want, what)
	if vim.deep_equal(got, want) then
		return
	end
	failures = failures + 1
	print(("FAIL %s:\n  got  %s\n  want %s"):format(what, vim.inspect(got), vim.inspect(want)))
end

local function pane(process)
	return {
		get_foreground_process_name = function()
			return process
		end,
	}
end

-- front
for process, want in pairs({
	["/etc/profiles/per-user/me/bin/herdr"] = "herdr",
	["/nix/store/abc-neovim/bin/nvim"] = "vim",
	["/usr/bin/vim.basic"] = "vim",
	["C:\\bin\\NVIM.EXE"] = "vim",
	["/usr/bin/vimtutor"] = false,
	["/bin/fish"] = false,
	["herdr-nav"] = false,
	[""] = false,
}) do
	eq(nav.front(pane(process)) or false, want, "front(" .. process .. ")")
end
eq(nav.front(pane(nil)), nil, "front(nil)") -- mux panes may not report one

-- ctrl+hjkl
local send_h = { "SendKey", { key = "h", mods = "CTRL" } }
eq(nav.nav_action(pane("/bin/herdr"), "h", "Left"), send_h, "ctrl+h to herdr")
eq(nav.nav_action(pane("/bin/nvim"), "h", "Left"), send_h, "ctrl+h to nvim")
eq(nav.nav_action(pane("/bin/fish"), "h", "Left"), { "ActivatePaneDirection", "Left" }, "ctrl+h in fish")

-- ctrl+a
eq(nav.leader_action(pane("/bin/herdr")), { "SendKey", { key = "a", mods = "CTRL" } }, "ctrl+a to herdr")
local leader = { "ActivateKeyTable", { name = "leader", one_shot = true, timeout_milliseconds = 1000 } }
eq(nav.leader_action(pane("/bin/fish")), leader, "ctrl+a in fish")
eq(nav.leader_action(pane("/bin/nvim")), leader, "ctrl+a in nvim is still WezTerm's leader")

-- apply_to_config binds ctrl+a and ctrl+hjkl to callbacks that perform the
-- chosen action on the pane.
local config = { keys = { { key = "q" } } }
local leader_keys = { { key = "c" } }
nav.apply_to_config(config, leader_keys)
eq(config.key_tables.leader, leader_keys, "leader key table")
local bound = {}
for _, k in ipairs(config.keys) do
	bound[#bound + 1] = k.key .. (k.mods and ("/" .. k.mods) or "")
end
eq(bound, { "q", "a/CTRL", "h/CTRL", "j/CTRL", "k/CTRL", "l/CTRL", "]/SUPER", "[/SUPER" }, "bound keys")

-- cmd+]/[: herdr gets its prefix+]/[ (tg.nav); elsewhere WezTerm's tabs.
eq(
	nav.tab_action(pane("/bin/herdr"), "]", 1),
	{ "Multiple", { { "SendKey", { key = "a", mods = "CTRL" } }, { "SendKey", { key = "]" } } } },
	"cmd+] to herdr"
)
eq(nav.tab_action(pane("/bin/fish"), "[", -1), { "ActivateTabRelative", -1 }, "cmd+[ in fish")

local performed
local window = {
	perform_action = function(_, action, p)
		performed = { action, p }
	end,
}
local fish = pane("/bin/fish")
config.keys[4].action[2](window, fish) -- ctrl+j
eq(performed, { { "ActivatePaneDirection", "Down" }, fish }, "ctrl+j callback")

if failures > 0 then
	print(failures .. " failure(s)")
	os.exit(1)
end
print("ok")

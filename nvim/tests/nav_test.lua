-- Run: nvim --headless -u NONE -l nvim/tests/nav_test.lua
-- Checks that nav.go moves between windows and hands off only at an edge.
local root = debug.getinfo(1, "S").source:match("^@(.*)/tests/[^/]*$") or "nvim"
-- By path: require would search nvim's runtimepath, i.e. whatever
-- ~/.config/nvim points at, not necessarily this checkout.
local nav = dofile(root .. "/lua/nav.lua")

local real_handoff = nav.handoff
local handoffs = {}
nav.handoff = function(direction)
  table.insert(handoffs, direction)
end

local failures = 0
local function eq(got, want, what)
  if not vim.deep_equal(got, want) then
    failures = failures + 1
    print(("FAIL %s:\n  got  %s\n  want %s"):format(what, vim.inspect(got), vim.inspect(want)))
  end
end

-- Layout: left | (top / bottom)
vim.cmd("vsplit")
vim.cmd("wincmd l")
vim.cmd("split")
local left, top, bottom = vim.fn.win_getid(1), vim.fn.win_getid(2), vim.fn.win_getid(3)

local function case(start, dir, want_win, want_handoff, what)
  handoffs = {}
  vim.api.nvim_set_current_win(start)
  nav.go(dir)
  eq(vim.api.nvim_get_current_win(), want_win, what .. ": window")
  eq(handoffs, want_handoff, what .. ": handoff")
end

case(top, "h", left, {}, "top h moves left")
case(left, "l", top, {}, "left l moves right")
case(top, "j", bottom, {}, "top j moves down")
case(left, "h", left, { "left" }, "left edge hands off")
case(top, "l", top, { "right" }, "right edge hands off")
case(top, "k", top, { "up" }, "top edge hands off")
case(bottom, "j", bottom, { "down" }, "bottom edge hands off")
case(left, "j", left, { "down" }, "full-height window hands off down")

-- A floating window never hands off: wincmd leaves it for the layout
-- window underneath (nvim 0.12), which counts as a move.
local float = vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), true, {
  relative = "editor",
  row = 1,
  col = 1,
  width = 10,
  height = 3,
})
for _, dir in ipairs({ "h", "j", "k", "l" }) do
  handoffs = {}
  vim.api.nvim_set_current_win(float)
  nav.go(dir)
  eq(handoffs, {}, "float " .. dir .. ": handoff")
end
vim.api.nvim_win_close(float, true)

-- A lone window always hands off.
vim.cmd("only")
case(vim.api.nvim_get_current_win(), "l", vim.api.nvim_get_current_win(), { "right" }, "single window")

-- The real handoff, outside herdr: WezTerm user vars, each value new.
local sent = {}
nav.send = function(seq)
  table.insert(sent, seq)
end
local function user_var(name, value)
  return ("\027]1337;SetUserVar=%s=%s\007"):format(name, vim.base64.encode(value))
end
vim.env.HERDR_SOCKET_PATH = nil
real_handoff("left")
real_handoff("left")
eq(sent, { user_var("tg_nav_edge", "left:1"), user_var("tg_nav_edge", "left:2") }, "handoff outside herdr")

-- setup announces nvim outside herdr, and stops while suspended.
sent = {}
nav.setup()
for _, event in ipairs({ "UIEnter", "VimSuspend", "VimResume", "VimLeavePre" }) do
  vim.api.nvim_exec_autocmds(event, { group = "tg_nav" })
end
eq(sent, {
  user_var("tg_nav_vim", "1"),
  user_var("tg_nav_vim", ""),
  user_var("tg_nav_vim", "1"),
  user_var("tg_nav_vim", ""),
}, "setup outside herdr")

-- Inside herdr: no user vars (herdr drops them), and no autocmds.
sent = {}
vim.api.nvim_del_augroup_by_name("tg_nav")
vim.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock"
nav.setup()
eq(pcall(vim.api.nvim_get_autocmds, { group = "tg_nav" }), false, "no autocmds inside herdr")

-- Inside herdr with herdr-nav missing: one warning, not one per key.
vim.env.PATH = ""
vim.env.HOME = vim.fn.tempname()
local warnings = {}
vim.notify = function(msg)
  table.insert(warnings, msg)
end
real_handoff("left")
real_handoff("left")
eq(#warnings, 1, "one warning for a missing herdr-nav")
eq(sent, {}, "nothing sent inside herdr")

if failures > 0 then
  print(failures .. " failure(s)")
  os.exit(1)
end
print("ok")

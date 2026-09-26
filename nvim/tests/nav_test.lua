-- Run: nvim --headless -u NONE -l nvim/tests/nav_test.lua
-- Checks that nav.go moves between windows and hands off only at an edge.
local root = debug.getinfo(1, "S").source:match("^@(.*)/tests/[^/]*$") or "nvim"
package.path = root .. "/lua/?.lua;" .. package.path
local nav = require("nav")

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

-- A lone window always hands off.
vim.cmd("only")
case(vim.api.nvim_get_current_win(), "l", vim.api.nvim_get_current_win(), { "right" }, "single window")

if failures > 0 then
  print(failures .. " failure(s)")
  os.exit(1)
end
print("ok")

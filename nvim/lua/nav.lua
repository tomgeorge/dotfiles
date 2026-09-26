-- ctrl+hjkl moves between nvim windows; at nvim's edge it hands off to herdr
-- or WezTerm (see NAV_PLAN.md).
--
-- In a herdr pane the handoff runs herdr-nav (herdr-plugins/nav). Anywhere
-- else, locally or over ssh, it tells WezTerm through user vars: tg_nav_vim
-- says nvim is in front (so WezTerm passes ctrl+hjkl through ssh), and
-- tg_nav_edge asks WezTerm to move. herdr doesn't pass user vars on, so
-- they're no use inside it.
local M = {}

local directions = { h = "left", j = "down", k = "up", l = "right" }

local function in_herdr()
  return (vim.env.HERDR_SOCKET_PATH or "") ~= ""
end

-- ~/.local/bin isn't on every PATH nvim starts with, so fall back to where
-- link.sh puts it.
local function herdr_nav()
  local path = vim.fn.exepath("herdr-nav")
  if path ~= "" then
    return path
  end
  path = vim.fn.expand("~/.local/bin/herdr-nav")
  if vim.fn.executable(path) == 1 then
    return path
  end
  return nil
end

-- Overridable so tests can capture what reaches the terminal.
M.send = function(seq)
  if vim.api.nvim_ui_send then
    vim.api.nvim_ui_send(seq)
  else
    -- Before 0.12 (an older nvim on an ssh host): stderr is the terminal.
    vim.fn.chansend(vim.v.stderr, seq)
  end
end

local function set_user_var(name, value)
  M.send(("\027]1337;SetUserVar=%s=%s\007"):format(name, vim.base64.encode(value)))
end

local warned = false
local edges = 0

-- Overridable so tests can record the handoff instead of running it.
M.handoff = function(direction)
  if not in_herdr() then
    -- The counter makes every value new: WezTerm only fires on a change.
    edges = edges + 1
    set_user_var("tg_nav_edge", ("%s:%d"):format(direction, edges))
    return
  end
  local bin = herdr_nav()
  if not bin then
    if not warned then
      warned = true
      vim.notify(
        "herdr-nav not found: ctrl+hjkl won't leave nvim. Run `make link` in herdr-plugins/.",
        vim.log.levels.WARN
      )
    end
    return
  end
  vim.system({ bin, "pane", direction }, { text = true }, function(res)
    if res.code ~= 0 then
      vim.schedule(function()
        vim.notify("herdr-nav: " .. vim.trim(res.stderr or ""), vim.log.levels.WARN)
      end)
    end
  end)
end

-- go moves one window in dir ("h", "j", "k" or "l"), handing off when nvim
-- has no window that way.
function M.go(dir)
  local win = vim.api.nvim_get_current_win()
  vim.cmd.wincmd(dir)
  if vim.api.nvim_get_current_win() == win then
    M.handoff(directions[dir])
  end
end

-- setup announces nvim to WezTerm while it's in front: from start to exit,
-- and not while suspended (ctrl+z hands the terminal back to the shell).
function M.setup()
  if in_herdr() then
    return
  end
  local group = vim.api.nvim_create_augroup("tg_nav", { clear = true })
  local function announce(value)
    return function()
      set_user_var("tg_nav_vim", value)
    end
  end
  vim.api.nvim_create_autocmd({ "UIEnter", "VimResume" }, { group = group, callback = announce("1") })
  vim.api.nvim_create_autocmd({ "VimLeavePre", "VimSuspend" }, { group = group, callback = announce("") })
end

return M

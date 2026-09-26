-- ctrl+hjkl moves between nvim windows; at nvim's edge it hands off to herdr
-- or WezTerm through herdr-nav (herdr-plugins/nav, see NAV_PLAN.md).
local M = {}

local directions = { h = "left", j = "down", k = "up", l = "right" }

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

-- Overridable so tests can record the handoff instead of running it.
M.handoff = function(direction)
  local bin = herdr_nav()
  if not bin then
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

return M

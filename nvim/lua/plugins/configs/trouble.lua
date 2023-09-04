local M = {}

M.opts = {
  -- Make it like unimpaired, j and k still seem to work though
  action_keys = {
    next = "]q",
    previous = "[q",
  },
}

--
-- TODO: What happens when I run :cclose and then ]q
--
local replace_quickfix = function()
  local title = vim.fn.getloclist(vim.fn.win_getid(), { title = 0 }).title
  print("title is " .. title)
  if title ~= nil and title == "Help TOC" then
    return
  end

  local ok, trouble = pcall(require, "trouble")
  if ok then
    vim.defer_fn(function()
      print("in defered fn")
      vim.cmd("cclose")
      trouble.open("quickfix")
    end, 0)
  end
end

local function use_trouble()
  local status_ok, trouble = pcall(require, "trouble")
  if status_ok then
    if vim.fn.getloclist(0, { filewinid = 1 }).filewinid ~= 0 then
      vim.defer_fn(function()
        vim.cmd.lclose()
        trouble.open("loclist")
      end, 0)
    end
    vim.defer_fn(function()
      vim.cmd.cclose()
      trouble.open("quickfix")
    end, 0)
  end
end

M.setup_autocmd = function()
  print("registering autocmd")
  local group = vim.api.nvim_create_augroup("ReplaceQuickfixWithTrouble", { clear = true })
  vim.api.nvim_create_autocmd("BufWinEnter", {
    pattern = "quickfix",
    group = group,
    callback = use_trouble,
  })
end

M.setup = function()
  local trouble = require("trouble")
  trouble.setup(M.opts)
end

return M

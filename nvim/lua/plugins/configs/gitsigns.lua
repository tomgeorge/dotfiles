local utils = require("core.utils")

local M = {}

M.gitsigns = {
  signs = {
    add = { text = "│" },
    change = { text = "│" },
    delete = { text = "󰍵" },
    topdelete = { text = "‾" },
    changedelete = { text = "~" },
    untracked = { text = "│" },
  },
  on_attach = function(bufnr)
    utils.load_mappings("gitsigns", { buffer = bufnr })
  end,
}

M.get_visual_selection_lines = function()
  local bufnr = vim.api.nvim_get_current_buf() or 0
  local region = vim.region(bufnr, "v", ".", "'z'", false)
  local rows = {}
  for row, _ in pairs(region) do
    table.insert(rows, row)
  end
  table.sort(rows)
  local startRow, endRow = rows[1] + 1, rows[#rows] + 1
  return { startRow, endRow }
end

return M

local M = {}

M.opts = {
  key_labels = {
    ["<leader>"] = "SPC",
  },
}

M.triggers = {
  ["<leader>f"] = { name = "File Operations" },
  ["<leader>g"] = { name = "Git Operations" },
  ["<leader>x"] = { name = "Trouble" },
}
return M

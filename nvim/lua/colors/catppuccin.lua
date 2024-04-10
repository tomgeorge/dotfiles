local M = {}

M.plugin_string = "catppuccin/nvim"
M.name = "catppuccin"

M.opts = {
  flavour = "frappe",
  integrations = {
    telescope = {
      enabled = true,
      style = "nvchad",
    },
  },
}

return M

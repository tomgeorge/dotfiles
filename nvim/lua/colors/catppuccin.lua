local M = {}

M.plugin_string = "catppuccin/nvim"

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

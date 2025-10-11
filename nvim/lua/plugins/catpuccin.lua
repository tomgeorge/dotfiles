return {
  "catppuccin/nvim",
  name = "catppuccin",
  opts = {
    flavor = "frappe",
  },
  priority = 1000,
  config = function()
    require("catppuccin").setup({
      flavor = "frappe",
    })
    vim.cmd("colorscheme catppuccin-frappe")
  end,
}

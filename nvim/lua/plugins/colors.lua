return {
  {
    "webhooked/kanso.nvim",
    opts = {
      theme = "zen",
    },
    lazy = false,
    priority = 1000,
  },
  {
    "catppuccin/nvim",
    name = "catppuccin",
    opts = {
      flavour = "frappe",
    },
    priority = 1000,
    lazy = false,
  },
  { "EdenEast/nightfox.nvim" },
  { "sainnhe/sonokai" },
  { "sainnhe/edge" },
  {
    "sainnhe/gruvbox-material",
    lazy = false,
    priority = 100,
    init = function()
      vim.g.gruvbox_material_background = "medium"
    end,
  },
}

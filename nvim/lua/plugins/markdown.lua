---@module 'lazy'

---@type LazySpec
return {
  {
    enabled = false,
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = { "nvim-treesitter/nvim-treesitter", "mini.nvim/mini.icons" }, -- if you prefer nvim-web-devicons
    ---@module 'render-markdown'
    ---@type render.md.UserConfig
    opts = {},
  },
  {
    "blackhat-7/vellum.nvim",
    ft = "markdown",
    keys = { { "<leader>mp", "<cmd>Vellum<cr>", desc = "markdown preview" } },
  },
}

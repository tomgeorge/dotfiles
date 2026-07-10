---@module 'lazy'

---@type LazySpec
return {
  enabled = false,
  "MeanderingProgrammer/render-markdown.nvim",
  dependencies = { "mini.nvim/mini.icons" }, -- if you prefer nvim-web-devicons
  ---@module 'render-markdown'
  ---@type render.md.UserConfig
  opts = {
    completions = { lsp = { enabled = true } },
  },
}

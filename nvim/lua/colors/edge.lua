return {
  plugin_string = "sainnhe/edge",
  config = function()
    vim.g.edge_style = "aura"
    vim.g.edge_enable_italic = true
    vim.cmd("colorscheme edge")
  end,
}

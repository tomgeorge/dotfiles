return {
  plugin_string = "sainnhe/gruvbox-material",
  config = function()
    vim.o.background = "dark"
    vim.g.gruvbox_material_background = "medium"
    vim.cmd("colorscheme gruvbox-material")
  end,
}

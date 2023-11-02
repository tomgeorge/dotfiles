local M = {}

M.colorscheme_plugin_spec = function(selected_colorscheme)
  local colorscheme_path = "colors." .. selected_colorscheme
  print("colorscheme_path is " .. colorscheme_path)
  local colorscheme = require(colorscheme_path)

  return {
    colorscheme.plugin_string,
    lazy = false,
    priority = 1000,
    config = function()
      require(selected_colorscheme).setup(colorscheme.opts)
      vim.cmd("colorscheme " .. selected_colorscheme)
    end,
  }
end

return M

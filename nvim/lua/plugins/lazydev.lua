---@module 'lazy'
---@type lazy.PluginSpec
return {
  "folke/lazydev.nvim",
  dependencies = {
    "DrKJeff16/wezterm-types",
  },
  ft = "lua",
  opts = {
    library = {
      { path = "wezterm-types", words = { "wezterm" } },
    },
  },
  config = true,
  keys = {
    {
      "<leader>lu",
      function()
        require("commands").unload_lua_ns()
      end,
      desc = "Unload lua namespaces",
    },
  },
}

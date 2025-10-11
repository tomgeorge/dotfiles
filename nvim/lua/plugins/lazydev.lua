---@module 'lazy'
---@type lazy.PluginSpec
return {
  "folke/lazydev.nvim",
  ft = "lua",
  opts = {},
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

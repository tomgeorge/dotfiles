---@type vim.lsp.Config
return {
  cmd = { "lua-language-server" },
  root_markers = { ".luarc.json", ".luarc.jsonc", ".luacheckrc" },
  filetypes = { "lua" },
  settings = {
    Lua = {
      runtime = {
        version = "LuaJIT",
      },
      hint = {
        enable = true,
        arrayIndex = "Disable",
      },
      completion = { callSnippet = "Both" },
      workspace = {
        library = {
          vim.env.VIMRUNTIME,
          "${3rd}/luv/library}",
        },
      },
    },
  },
}

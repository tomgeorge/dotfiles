---@type vim.lsp.Config
return {
  cmd = { "gleam", "lsp" },
  root_markers = { "gleam.toml", ".git" },
}

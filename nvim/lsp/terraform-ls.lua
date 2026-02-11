---@type vim.lsp.Config
return {
  cmd = { "terraform-ls", "serve", "-req-concurrency", "14" },
  root_markers = { ".terraform", ".git" },
  filetypes = { "terraform", "terraform-vars" },
}

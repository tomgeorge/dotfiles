---@type vim.lsp.Config
return {
  cmd = { "gopls" },
  root_markers = { "go.work", "go.mod", ".git" },
  filetypes = { "go" },
  settings = {
    gopls = {
      gofumpt = true,
      codelenses = {
        gc_details = false,
        generate = true,
        regenerate_cgo = true,
        run_govulncheck = true,
        test = true,
        tidy = true,
        upgrade_dependency = true,
        vendor = true,
      },
      analyses = {
        nilness = true,
        unusedwrite = true,
        unusedparams = true,
        useany = true,
      },
      -- hints = {
      --   parameterNames = true,
      --   assignVariableTypes = true,
      --   compositeLiteralFields = true,
      --   compositeLiteralTypes = true,
      --   constantValues = true,
      --   functionTypeParameters = true,
      --   rangeVariableTypes = true,
      -- },
      staticcheck = true,
      usePlaceholders = true,
      directoryFilters = { "-.git", "-.vscode", "-.idea", "-.vscode-test", "-node_modules" },
      semanticTokens = true,
    },
  },
}

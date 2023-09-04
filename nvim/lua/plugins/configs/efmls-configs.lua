local M = {}

local stylua = require("efmls-configs.formatters.stylua")
local gofmt = require("efmls-configs.formatters.gofmt")
local languages = {
  lua = { stylua },
  go = { gofmt },
}

M.efmls_config = {
  filetypes = vim.tbl_keys(languages),
  settings = {
    rootMarkers = { ".git" },
    languages = languages,
  },
  init_options = {
    documentFormatting = true,
    documentRangeFormatting = true,
  },
}

return M

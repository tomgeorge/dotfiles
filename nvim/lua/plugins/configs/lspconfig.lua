local M = {}
local utils = require("core.utils")
local lspconfig = require("lspconfig")

-- export on_attach & capabilities for custom lspconfigs

M.on_attach = function(client, bufnr)
  if client.server_capabilities.inlayHintProvider then
    vim.lsp.inlay_hint(bufnr, true)
  end
  utils.load_mappings("lspconfig", { buffer = bufnr })
end

M.capabilities = vim.lsp.protocol.make_client_capabilities()

M.capabilities = vim.tbl_deep_extend("force", M.capabilities, require("cmp_nvim_lsp").default_capabilities())

M.capabilities.textDocument.completion.completionItem = {
  documentationFormat = { "markdown", "plaintext" },
  snippetSupport = true,
  preselectSupport = true,
  insertReplaceSupport = true,
  labelDetailsSupport = true,
  deprecatedSupport = true,
  commitCharactersSupport = true,
  tagSupport = { valueSet = { 1 } },
  resolveSupport = {
    properties = {
      "documentation",
      "detail",
      "additionalTextEdits",
    },
  },
}

local new_servers = {
  lua_ls = {
    settings = {
      Lua = {
        completion = {
          callSnippet = "Replace",
        },
        diagnostics = {
          globals = { "vim" },
        },
        workspace = {
          library = {
            [vim.fn.expand("$VIMRUNTIME/lua")] = true,
            [vim.fn.expand("$VIMRUNTIME/lua/vim/lsp")] = true,
          },
          maxPreload = 100000,
          preloadFileSize = 10000,
          checkThirdParty = false, -- https://github.com/LunarVim/LunarVim/issues/4049
        },
      },
    },
  },
  terraformls = {
    capabilities = {
      experimental = {
        showReferenceCommand = "client.showReferences",
      },
    },
  },
  gopls = {
    settings = {
      gopls = {
        -- staticcheck = true,
        -- analyses = {
        --   unusedparams = true,
        --   shadow = true,
        -- },
        hints = {
          parameterNames = false,
          assignVariableTypes = false,
          compositeLiteralFields = false,
          compositeLiteralTypes = false,
          constantValues = false,
          functionTypeParameters = false,
          rangeVariableTypes = false,
        },
      },
    },
  },
  bashls = {},
  clojure_lsp = {},
  clangd = {},
  html = {},
  cssls = {},
}

require("neodev").setup({
  override = function(_, library)
    library.enabled = true
    library.plugins = true
  end,
})

for server, settings in pairs(new_servers) do
  local extra_capabilities = settings.capabilities or {}
  capabilities = vim.tbl_deep_extend("force", M.capabilities, extra_capabilities)
  lspconfig[server].setup({
    on_attach = M.on_attach,
    capabilities = capabilities,
    settings = settings.settings or {},
  })
end

local function lspSymbol(name, icon)
  local hl = "DiagnosticSign" .. name
  vim.fn.sign_define(hl, { text = icon, numhl = hl, texthl = hl })
end

lspSymbol("Error", "󰅙")
lspSymbol("Info", "󰋼")
lspSymbol("Hint", "󰌵")
lspSymbol("Warn", "")

vim.diagnostic.config({
  virtual_text = {
    prefix = "",
  },
  signs = true,
  underline = true,
  update_in_insert = false,
})

vim.lsp.handlers["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, {
  border = "single",
})
vim.lsp.handlers["textDocument/signatureHelp"] = vim.lsp.with(vim.lsp.handlers.signature_help, {
  border = "single",
  focusable = false,
  relative = "cursor",
})

-- Borders for LspInfo winodw
local win = require("lspconfig.ui.windows")
local _default_opts = win.default_opts

win.default_opts = function(options)
  local opts = _default_opts(options)
  opts.border = "single"
  return opts
end

return M

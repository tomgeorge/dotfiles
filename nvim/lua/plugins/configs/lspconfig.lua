local M = {}
local utils = require('core.utils')
local lspconfig = require('lspconfig')

-- export on_attach & capabilities for custom lspconfigs

M.on_attach = function(client, bufnr)
  if client.name ~= 'efm' then
    client.server_capabilities.documentFormattingProvider = false
    client.server_capabilities.documentRangeFormattingProvider = false
  end
  -- if client.server_capabilities.inlayHintProvider then
  --   vim.lsp.buf.inlay_hint(bufnr, true)
  -- end
  utils.load_mappings('lspconfig', { buffer = bufnr })
end

M.capabilities = vim.lsp.protocol.make_client_capabilities()

M.capabilities.textDocument.completion.completionItem = {
  documentationFormat = { 'markdown', 'plaintext' },
  snippetSupport = true,
  preselectSupport = true,
  insertReplaceSupport = true,
  labelDetailsSupport = true,
  deprecatedSupport = true,
  commitCharactersSupport = true,
  tagSupport = { valueSet = { 1 } },
  resolveSupport = {
    properties = {
      'documentation',
      'detail',
      'additionalTextEdits',
    },
  },
}

local servers = { 'html', 'cssls', 'clangd', 'lua_ls', 'gopls', 'bashls', 'efm' }

for _, lsp in ipairs(servers) do
  if lsp ~= 'efm' then
    lspconfig[lsp].setup({
      on_attach = M.on_attach,
      capabilities = M.capabilities,
    })
  else
    lspconfig[lsp].setup(vim.tbl_extend('force', require('plugins.configs.efmls-configs').efmls_config, {
      on_attach = M.on_attach,
      capabilities = M.capabilities,
    }))
  end
end

require('neodev').setup({
  override = function(_, library)
    library.enabled = true
    library.plugins = true
  end,
})

lspconfig.lua_ls.setup({
  on_attach = M.on_attach,
  capabilities = M.capabilities,

  settings = {
    Lua = {
      completion = {
        callSnippet = 'Replace',
      },
      diagnostics = {
        globals = { 'vim' },
      },
      workspace = {
        library = {
          [vim.fn.expand('$VIMRUNTIME/lua')] = true,
          [vim.fn.expand('$VIMRUNTIME/lua/vim/lsp')] = true,
        },
        maxPreload = 100000,
        preloadFileSize = 10000,
        checkThirdParty = false, -- https://github.com/LunarVim/LunarVim/issues/4049
      },
    },
  },
})

local function lspSymbol(name, icon)
  local hl = 'DiagnosticSign' .. name
  vim.fn.sign_define(hl, { text = icon, numhl = hl, texthl = hl })
end

lspSymbol('Error', '󰅙')
lspSymbol('Info', '󰋼')
lspSymbol('Hint', '󰌵')
lspSymbol('Warn', '')

vim.diagnostic.config({
  virtual_text = {
    prefix = '',
  },
  signs = true,
  underline = true,
  update_in_insert = false,
})

vim.lsp.handlers['textDocument/hover'] = vim.lsp.with(vim.lsp.handlers.hover, {
  border = 'single',
})
vim.lsp.handlers['textDocument/signatureHelp'] = vim.lsp.with(vim.lsp.handlers.signature_help, {
  border = 'single',
  focusable = false,
  relative = 'cursor',
})

-- Borders for LspInfo winodw
local win = require('lspconfig.ui.windows')
local _default_opts = win.default_opts

win.default_opts = function(options)
  local opts = _default_opts(options)
  opts.border = 'single'
  return opts
end

local t = {
  [0] = 'one',
  [1] = 'two',
  [2] = 'three',
}

table.remove(t, 1)

return M

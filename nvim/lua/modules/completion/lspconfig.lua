local api = vim.api
local lspconfig = require('lspconfig')
local mappings = require('modules.completion.mappings')

-- if not packer_plugins['cmp-nvim-lsp'].loaded then
--  print("cmp-nvim-lsp not loaded")
--  vim.cmd([[packadd cmp-nvim-lsp]])
-- end
local capabilities = require('cmp_nvim_lsp').default_capabilities()

local signs = {
  Error = ' ',
  Warn = ' ',
  Info = ' ',
  Hint = 'ﴞ ',
}
for type, icon in pairs(signs) do
  local hl = 'DiagnosticSign' .. type
  vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
end

vim.diagnostic.config({
  signs = true,
  update_in_insert = false,
  underline = true,
  severity_sort = true,
  virtual_text = true,
  float = {
    focusable = false,
    style = 'minimal',
    border = 'rounded',
    source = 'always',
  },
  document_highlight = true,
  code_lens_refresh = true,
})

local on_attach = function(client, bufnr)
  if client.server_capabilities.documentFormattingProvider then
    api.nvim_create_autocmd('BufWritePre', {
      pattern = client.config.filetypes,
      callback = function()
        vim.lsp.buf.format({
          bufnr = bufnr,
          async = true,
        })
      end,
    })
  end
  mappings.setup(bufnr)
end

local servers = { 'tsserver', 'clojure_lsp', 'gopls'}

for _, server in ipairs(servers) do
  print('in for loop')
  if server == "clojure_lsp" then
    lspconfig[server].setup {
      capabilities = capabilities,
      on_attach = on_attach,
      init_options = {
        "trace.server" == "debug",
      },
    }
  end
  lspconfig[server].setup {
    capabilities = capabilities,
    on_attach = on_attach
  }
end

lspconfig.sumneko_lua.setup({
  on_attach = on_attach,
  settings = {
    Lua = {
      diagnostics = {
        enable = true,
        globals = { 'vim', 'packer_plugins' },
      },
      runtime = { version = 'LuaJIT' },
      workspace = {
        library = vim.list_extend({ [vim.fn.expand('$VIMRUNTIME/lua')] = true }, {}),
      },
    },
  },
})

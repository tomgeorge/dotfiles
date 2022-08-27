local config = {}

-- config server in this function
function config.lspconfig()
  -- print('calling nvim_lsp')
  require('modules.completion.lspconfig')
end

function config.nvim_cmp()
  local cmp = require('cmp')

  cmp.setup({
    preselect = cmp.PreselectMode.Item,
    window = {
      completion = cmp.config.window.bordered(),
      documentation = cmp.config.window.bordered(),
    },
    formatting = {
      max_width = 0,
      kind_icons = {
        Class = ' ',
        Color = ' ',
        Constant = 'ﲀ ',
        Constructor = ' ',
        Enum = '練',
        EnumMember = ' ',
        Event = ' ',
        Field = ' ',
        File = '',
        Folder = ' ',
        Function = ' ',
        Interface = 'ﰮ ',
        Keyword = ' ',
        Method = ' ',
        Module = ' ',
        Operator = '',
        Property = ' ',
        Reference = ' ',
        Snippet = ' ',
        Struct = ' ',
        Text = ' ',
        TypeParameter = ' ',
        Unit = '塞',
        Value = ' ',
        Variable = ' ',
      },
      source_names = {
        nvim_lsp = '[LSP]',
        path = '[Path]',
        luasnip = '[Snippet]',
        buffer = '[Buffer]',
      },
      format = require('lspkind').cmp_format({
        mode = 'text_symbol'
      }),
    },
    snippet = {
      expand = function(args)
        require('luasnip').lsp_expand(args.body)
      end,
    },
    mapping = cmp.mapping.preset.insert({
      ['<C-b>'] = cmp.mapping.scroll_docs(-4),
      ['<C-f>'] = cmp.mapping.scroll_docs(4),
      ['<C-Space>'] = cmp.mapping.complete(),
      ['<C-e>'] = cmp.mapping.abort(),
      ['<CR>'] = cmp.mapping.confirm({ select = true }),
    }),
    sources = cmp.config.sources({
      { name = 'nvim_lsp' },
      { name = 'luasnip' },
      { name = 'nvim_lua' },
      { name = 'path' },
      { name = 'buffer', keyword_length = 5 },
      { name = 'nvim_lsp_signature_help' },
    }),
  })
end

function config.lua_snip()
  local ls = require('luasnip')
  local types = require('luasnip.util.types')
  ls.config.set_config({
    history = true,
    enable_autosnippets = true,
    updateevents = 'TextChanged,TextChangedI',
    ext_opts = {
      [types.choiceNode] = {
        active = {
          virt_text = { { '<- choiceNode', 'Comment' } },
        },
      },
    },
  })
  require('luasnip.loaders.from_lua').lazy_load({ paths = vim.fn.stdpath('config') .. '/snippets' })
  require('luasnip.loaders.from_vscode').lazy_load()
  require('luasnip.loaders.from_vscode').lazy_load({
    paths = { './snippets/' },
  })
end

 -- print(vim.inspect(config))
return config

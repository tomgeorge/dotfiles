local nvim_autopairs = require('nvim-autopairs')

nvim_autopairs.setup({
  check_ts = true,
  ts_config = {
    lua = { 'string' },
    javascript = { 'template_string' },
  },
  disable_filetype = { 'TelescopePrompt' },
})

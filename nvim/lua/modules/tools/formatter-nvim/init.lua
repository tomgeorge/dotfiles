local formatter = require('formatter')

formatter.setup {
  filetype = {
    lua = {
      require('formatter.filetypes.lua').stylua
    },
    typescript = {
      require('formatter.filetypes.typescript').prettier,
      require('formatter.filetypes.typescript').eslint
    },
    typescriptreact = {
      require('formatter.filetypes.typescriptreact').eslint,
      require('formatter.filetypes.typescriptreact').prettier,
    }
  }
}

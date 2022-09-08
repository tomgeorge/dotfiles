vim.g.maplocalleader = ' '
vim.keymap.set('n', '<localleader>hi', 'echo "Hi!!!!"<CR>')
vim.cmd[[
  let g:conjure#mapping#doc_word = "K"
]]

local which_key = require('which-key')

which_key.register({
  Space = {
    name ="LSP",
    cn = {function() vim.lsp.buf.execute_command({command="clean-ns"}) end, "Clean Namespace"},
  },
});

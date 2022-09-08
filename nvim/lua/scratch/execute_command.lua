vim.lsp.buf.execute_command({command = "clean-ns", arguments = { vim.uri_from_bufnr(0),
vim.api.nvim_win_get_cursor(0)[1], vim.api.nvim_win_get_cursor(0)[2] }});

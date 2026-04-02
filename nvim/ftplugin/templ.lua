--- treesitter doesn't always start for templ files
vim.api.nvim_create_autocmd("FileType", {
  pattern = "templ",
  callback = function()
    vim.treesitter.start()
  end,
})

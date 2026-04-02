vim.b.did_ftplugin = 1

--- treesitter doesn't always start for templ files
vim.api.nvim_create_autocmd("FileType", {
  pattern = "templ",
  callback = function()
    print("starting go")
    vim.treesitter.start()
  end,
})

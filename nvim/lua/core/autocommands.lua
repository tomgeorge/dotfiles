-- Enable Highlight on Yank
vim.api.nvim_create_autocmd("TextYankPost", {
  pattern = "*",
  group = vim.api.nvim_create_augroup("HihglightOnYank", { clear = true }),
  callback = function()
    vim.highlight.on_yank()
  end,
})


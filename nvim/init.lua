local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
require("core.options")
require("core.utils").load_mappings()
require("core.autocommands")

if not vim.loop.fs_stat(lazypath) then
  require("core.bootstrap").lazy(lazypath)
end
vim.opt.rtp:prepend(lazypath)

require("plugins")


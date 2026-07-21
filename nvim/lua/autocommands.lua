-- Enable Highlight on Yank
vim.api.nvim_create_autocmd("TextYankPost", {
  pattern = "*",
  group = vim.api.nvim_create_augroup("HihglightOnYank", { clear = true }),
  callback = function()
    vim.highlight.on_yank()
  end,
})

vim.api.nvim_create_autocmd("LspProgress", {
  ---@param ev {data: {client_id: integer, params: lsp.ProgressParams}
  callback = function(ev)
    local spinner = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
    vim.notify(vim.lsp.status(), vim.log.levels.INFO, {
      id = "lsp_progress",
      title = "LSP Progress",
      opts = function(notif)
        notif.icon = ev.data.params.value.kind == "end" and " "
          or spinner[math.floor(vim.uv.hrtime() / (1e6 * 80)) % #spinner + 1]
      end,
    })
  end,
})

vim.api.nvim_create_user_command("DiffPick", function()
  require("commands").compare_with()
end, { desc = "Diffview" })

-- Define languages which will have parsers installed and auto enabled
local languages = require("nvim-treesitter").get_available()
-- local languages = {
--   -- These are already pre-installed with Neovim. Used as an example.
--   "lua",
--   "vimdoc",
--   "markdown",
--   -- Add here more languages with which you want to use tree-sitter
--   -- To see available languages:
--   -- - Execute `:=require('nvim-treesitter').get_available()`
--   -- - Visit 'SUPPORTED_LANGUAGES.md' file at
--   --   https://github.com/nvim-treesitter/nvim-treesitter/blob/main
-- }
local isnt_installed = function(lang)
  return #vim.api.nvim_get_runtime_file("parser/" .. lang .. ".*", false) == 0
end
local to_install = vim.tbl_filter(isnt_installed, languages)
if #to_install > 0 then
  require("nvim-treesitter").install(to_install)
end

-- Enable tree-sitter after opening a file for a target language
local filetypes = {}
for _, lang in ipairs(languages) do
  for _, ft in ipairs(vim.treesitter.language.get_filetypes(lang)) do
    table.insert(filetypes, ft)
  end
end

local ts_start = function(ev)
  vim.treesitter.start(ev.buf)
end

vim.api.nvim_create_autocmd("FileType", {
  pattern = filetypes,
  callback = ts_start,
  desc = "Start treesitter",
})

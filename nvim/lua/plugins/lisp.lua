---@module 'lazy'
---@type LazySpec[]
return {
  {
    enabled = false,
    dir = vim.fn.getenv("HOME") .. "/git/nrepl-lsp",
    ft = { "clojure" },
    config = true,
    opts = {},
  },
  { "julienvincent/nvim-paredit", opts = {}, config = true },
  {
    "Olical/conjure",
    dev = true,
    enabled = false,
    dir = vim.fn.getenv("HOME") .. "/git/conjure",
    ft = { "clojure", "fennel" },
    init = function()
      vim.g["conjure#log#hud#anchor"] = "NE"
      vim.g["conjure#log#hud#border"] = "none"

      vim.g["conjure#mapping#doc_word"] = "K"
      vim.g["conjure#client#clojure#nrepl#connection#auto_repl#enabled"] = false
      vim.g["conjure#client#clojure#nrepl#eval#raw_out"] = true
      vim.g["conjure#client#clojure#nrepl#refresh#backend"] = "clj-reload"
    end,
    lazy = true,
    dependencies = {
      -- "tpope/vim-sexp-mappings-for-regular-people",
      "tpope/vim-repeat",
    },
  },
  -- {
  --   "tpope/vim-fireplace",
  --   config = true,
  -- },
}

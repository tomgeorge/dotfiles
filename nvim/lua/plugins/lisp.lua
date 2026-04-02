---@module 'lazy'
---@type LazySpec[]
return {
  {
    "Olical/conjure",
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
      { "julienvincent/nvim-paredit", opts = {}, config = true },
      -- "tpope/vim-sexp-mappings-for-regular-people",
      "tpope/vim-repeat",
      -- "guns/vim-sexp",
      -- {
      --   "akinsho/toggleterm.nvim",
      --   version = "*",
      --   config = true,
      --   keys = {
      --     {
      --       "<leader>tt",
      --       "<Cmd>ToggleTerm<CR>",
      --     },
      --   },
      -- },
    },
  },
}

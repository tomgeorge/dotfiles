return {
  {
    "Olical/conjure",
    ft = { "clojure" },
    config = function(_, opts)
      print("loading conjure for some reason")
      require("conjure.main").main()
      require("conjure.mapping")["on-filetype"]()
    end,
    dependencies = {
      "julienvincent/nvim-paredit",
      "tpope/vim-sexp-mappings-for-regular-people",
      "tpope/vim-repeat",
      "guns/vim-sexp",
      {
        "akinsho/toggleterm.nvim",
        version = "*",
        config = true,
      },
    },
  },
}

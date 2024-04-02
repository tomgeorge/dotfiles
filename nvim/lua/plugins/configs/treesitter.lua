return {
  ensure_installed = {
    "lua",
    "go",
    "bash",
    "vimdoc",
    "vim",
    "terraform",
    "query",
    "http",
    "json",
    "markdown",
    "markdown_inline",
  },

  textobjects = {
    select = {
      enable = true,
      -- Automatically jump forward to textobj, similar to targets.vim
      lookahead = true,
      -- mini.ai is taking care of keymaps
      keymaps = {},
    },
    move = {
      enable = true,
      set_jumps = false,
      goto_next_start = {
        ["]f"] = "@function.outer",
      },
      goto_next_end = {
        ["]F"] = "@function.outer",
      },
      goto_previous_start = {
        ["[f"] = "@function.outer",
      },
      goto_previous_end = {
        ["[F"] = "@function.outer",
      },
    },
    lsp_interop = {
      enable = true,
      floating_preview_opts = {
        border = "single",
      },
      peek_definition_code = {
        ["<leader>df"] = "@function.outer",
        ["<leader>dF"] = "@class.outer",
      },
    },
  },
  highlight = {
    enable = true,
    use_languagetree = true,
  },

  indent = { enable = true },
}

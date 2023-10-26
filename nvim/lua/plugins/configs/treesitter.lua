return {
  ensure_installed = { "lua", "go", "bash", "vimdoc", "vim", "terraform" },

  textobjects = {
    select = {
      enable = true,
      -- Automatically jump forward to textobj, similar to targets.vim
      lookahead = true,
      -- mini.ai is taking care of keymaps
      keymaps = {},
    },
  },
  highlight = {
    enable = true,
    use_languagetree = true,
  },

  indent = { enable = true },
}

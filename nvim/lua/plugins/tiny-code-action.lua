---@module 'lazy'

---@type LazySpec[]
return {
  {
    "rachartier/tiny-code-action.nvim",
    -- dev = true,
    -- dir = "~/git/tiny-code-action.nvim/",
    dependencies = {
      { "nvim-lua/plenary.nvim" },
      {
        "folke/snacks.nvim",
        opts = {
          terminal = {},
        },
      },
    },
    event = "LspAttach",
    opts = { picker = "snacks" },
  },
}

--- [[ *a [bb] ]]

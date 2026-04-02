return {
  {
    enabled = false,
    cmd = { "CodeCompanion", "CodeCompanionChat" },
    "olimorris/codecompanion.nvim",
    opts = {
      adapters = {
        anthropic = function()
          return require("codecompanion.adapters").extend("anthropic", {
            env = {},
          })
        end,
      },
      strategies = {
        chat = {
          adapter = "anthropic",
        },
      },
    },
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
    },
  },
}

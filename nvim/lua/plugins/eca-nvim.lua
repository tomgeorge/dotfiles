return {
  "eca/eca-nvim",
  dependencies = {
    "MunifTanjim/nui.nvim",
  },
  dir = "~/git/eca-nvim",
  ---@module 'eca'
  ---@type eca.Config
  opts = {
    server_args = "--verbose",
    log = {
      level = vim.log.levels.DEBUG,
    },
    mappings = {
      chat = "<leader>ai",
    },
    chat = {
      use_experimental_ui = true,
      mappings = {
        close = "<leader>ax",
      },
    },
  },
  cmd = { "EcaServerStart", "EcaServerStop", "EcaServerRestart" },
  keys = {
    {
      "<leader>ai",
      "<Cmd>EcaChat<CR>",
      desc = "ECA Chat",
    },
  },
}

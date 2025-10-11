---@module 'snacks'
return {
  "folke/snacks.nvim",
  priority = 1000,
  lazy = false,
  init = function()
    ---@diagnostic disable-next-line: duplicate-set-field
    vim.ui.select = function(...)
      return Snacks.picker.select(...)
    end
    ---@diagnostic disable-next-line: duplicate-set-field
    vim.ui.input = function(...)
      return Snacks.input(...)
    end
  end,
  ---@type snacks.Config
  opts = {
    -- your configuration comes ere
    -- or leave it empty to use the default settings
    -- refer to the configuration section below
    bigfile = { enabled = true },
    zen = { enabled = false },
    dim = { enabled = false },
    dasboard = { enabled = false },
    explorer = { enabled = false },
    indent = { enabled = true },
    input = { enabled = false },
    picker = { enabled = true },
    profiler = { enabled = true },
    notifier = { enabled = true },
    quickfile = { enabled = true },
    scope = { enabled = true },
    scroll = { enabled = false },
    statuscolumn = { enabled = false },
    words = { enabled = false },
  },
  keys = {
    {
      "<leader>ps",
      function()
        while true do
          print("hi")
        end
        Snacks.profiler.toggle()
      end,
      desc = "Toggle profiler",
    },
    {
      "]]",
      function()
        Snacks.words.jump(1)
      end,
      desc = "Jump to next reference",
    },
    {
      "[[",
      function()
        Snacks.words.jump(-1)
      end,
      desc = "Jump to next reference",
    },
    {
      "<leader><space>",
      function()
        Snacks.picker.smart()
      end,
      desc = "Smart find files",
    },
    {
      "<leader>n",
      function()
        Snacks.picker.notifications({ confirm = { "yank", "focus_preview" } })
      end,
      desc = "Search notifications",
    },
    {
      "<leader>ff",
      function()
        Snacks.picker.files()
      end,
      desc = "Search files",
    },
    {
      "<leader>,",
      function()
        Snacks.picker.buffers()
      end,
      desc = "Pick buffers",
    },
    {
      "<leader>sh",
      function()
        Snacks.picker.help()
      end,
      desc = "Search help files",
    },
    {
      "<leader>/",
      function()
        Snacks.picker.grep()
      end,
      desc = "Grep files",
    },
    {
      "<leader>:",
      function()
        Snacks.picker.command_history()
      end,
      desc = "Search command history",
    },
  },
}

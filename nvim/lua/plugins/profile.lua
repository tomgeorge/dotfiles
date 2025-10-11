return {
  "stevearc/profile.nvim",
  config = false,
  keys = {
    {
      "<leader>pe",
      function()
        require("commands").toggle_stevearc_profile()
      end,
      desc = "Toggle profiler (profile.nvim)",
    },
  },
}

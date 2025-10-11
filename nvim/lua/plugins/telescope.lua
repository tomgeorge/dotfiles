return {
  {
    enabled = false,
    "nvim-telescope/telescope.nvim",
    tag = "0.1.8",
    dependencies = {
      "nvim-lua/plenary.nvim",
      {
        "nvim-telescope/telescope-fzf-native.nvim",
        build = "make",
      },
    },
    cmd = "Telescope",
    keys = {
      {
        "<leader>ff",
        function()
          require("telescope.builtin").find_files()
        end,
        desc = "Find files",
      },
      {
        "<leader>fa",
        function()
          require("telescope.builtin").find_files({
            follow = true,
            hidden = true,
            no_ignore = true,
          })
        end,
        desc = "Find all",
      },
      {
        "<leader>fw",
        function()
          require("telescope.builtin").live_grep()
        end,
        desc = "Live grep",
      },
      {
        "<leader>fb",
        function()
          require("telescope.builtin").buffers()
        end,
        desc = "Search in buffers",
      },
    },
    init = function()
      require("utils").load_mappings("telescope")
    end,
    config = function()
      local config = require("plugins.configs.telescope")
      require("telescope").setup(config)
    end,
  },
}

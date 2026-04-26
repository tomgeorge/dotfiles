return {
  {
    "nvim-mini/mini.statusline",
    dependencies = {
      {
        "nvim-mini/mini.icons",
        version = "*",
        config = true,
      },
    },
    opts = {},
    config = true,
  },
  {
    "echasnovski/mini.bufremove",
    keys = {
      {
        "<leader>bd",
        function()
          require("mini.bufremove").delete()
        end,
        desc = "Delete buffer",
      },
      {
        "<leader>bh",
        function()
          require("mini.bufremove").unshow()
        end,
        desc = "Unshow buffer",
      },
      {
        "<leader>bH",
        function()
          require("mini.bufremove").unshow_in_window()
        end,
        desc = "Unshow buffer in all windows",
      },
    },
  },
  {
    "echasnovski/mini.clue",
    config = function()
      require("mini.clue").setup({
        window = {
          delay = 500,
          config = { width = "auto" },
        },
        triggers = {
          { mode = "n", keys = "<Leader>" },
          { mode = "x", keys = "<Leader>" },

          -- Built-in completion
          { mode = "i", keys = "<C-x>" },

          -- `g` key
          { mode = "n", keys = "g" },
          { mode = "x", keys = "g" },

          -- Marks
          { mode = "n", keys = "'" },
          { mode = "n", keys = "`" },
          { mode = "x", keys = "'" },
          { mode = "x", keys = "`" },

          -- Registers
          { mode = "n", keys = '"' },
          { mode = "x", keys = '"' },
          { mode = "i", keys = "<C-r>" },
          { mode = "c", keys = "<C-r>" },

          -- Window commands
          { mode = "n", keys = "<C-w>" },

          -- `z` key
          { mode = "n", keys = "z" },
          { mode = "x", keys = "z" },
        },
        clues = {
          {
            -- Enhance this by adding descriptions for <Leader> mapping groups
            require("mini.clue").gen_clues.builtin_completion(),
            require("mini.clue").gen_clues.g(),
            require("mini.clue").gen_clues.marks(),
            require("mini.clue").gen_clues.registers({ show_contents = true }),
            require("mini.clue").gen_clues.windows(),
            require("mini.clue").gen_clues.z(),
            { mode = "n", keys = "<Leader>f", desc = "+Files" },
            { mode = "n", keys = "<Leader>g", desc = "+Git" },
            { mode = "n", keys = "<Leader>b", desc = "+Buffer" },
          },
        },
      })
    end,
    lazy = false,
  },
  {
    "nvim-mini/mini.move",
    version = "*",
    event = "BufEnter",
    config = true,
  },
  {
    "echasnovski/mini.ai",
    event = "InsertEnter",
    config = function()
      local ai = require("mini.ai")
      ai.setup({
        custom_textobjects = {
          o = ai.gen_spec.treesitter({
            a = { "@block.outer", "@conditional.outer", "@loop.outer" },
            i = { "@block.inner", "@conditional.inner", "@loop.inner" },
          }, {}),
          f = ai.gen_spec.treesitter({ a = "@function.outer", i = "@function.inner" }, {}),
          c = ai.gen_spec.treesitter({ a = "@class.outer", i = "@class.inner" }, {}),
          t = { "<([%p%w]-)%f[^<%w][^<>]->.-</%1>", "^<.->().*()</[^/]->$" },
          d = { "%f[%d]%d+" }, -- digits
          e = { -- Word with case
            {
              "%u[%l%d]+%f[^%l%d]",
              "%f[%S][%l%d]+%f[^%l%d]",
              "%f[%P][%l%d]+%f[^%l%d]",
              "^[%l%d]+%f[^%l%d]",
            },
            "^().*()$",
          },
          g = function() -- Whole buffer, similar to `gg` and 'G' motion
            local from = { line = 1, col = 1 }
            local to = {
              line = vim.fn.line("$"),
              col = math.max(vim.fn.getline("$"):len(), 1),
            }
            return { from = from, to = to }
          end,
          u = ai.gen_spec.function_call(), -- u for "Usage"
          U = ai.gen_spec.function_call({ name_pattern = "[%w_]" }), -- without dot in function name
        },
      })
    end,
    lazy = false,
  },
  {
    "echasnovski/mini.jump",
    version = false,
    lazy = false,
    config = true,
  },
  {
    "echasnovski/mini.tabline",
    version = "*",
    lazy = false,
    config = true,
  },
  {
    "echasnovski/mini.pairs",
    version = "*",
    lazy = false,
    config = true,
  },
  {
    "echasnovski/mini.files",
    keys = {
      {
        "<leader>o",
        function()
          require("mini.files").open()
        end,
      },
    },
  },
  {
    "echasnovski/mini.surround",
    event = "BufEnter",
    config = true,
  },
  {
    "echasnovski/mini.operators",
    event = "BufEnter",
    config = true,
  },
  {
    "echasnovski/mini.test",
    ft = "lua",
    config = true,
  },
  -- {
  --   "echasnovski/mini.indentscope",
  --   version = false,
  --   event = { "BufReadPre", "BufNewFile" },
  --   opts = {
  --     symbol = "│",
  --     options = { true_as_border = true },
  --   },
  --   init = function()
  --     vim.api.nvim_create_autocmd("FileType", {
  --       pattern = {
  --         "help",
  --         "dashboard",
  --         "Trouble",
  --         "lazy",
  --         "toggleterm",
  --       },
  --       callback = function()
  --         vim.b.miniindentscope_disable = true
  --       end,
  --     })
  --   end,
  -- },
}

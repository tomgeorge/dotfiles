return {
  {
    "lewis6991/gitsigns.nvim",
    event = "BufRead",
    opts = {
      on_attach = function(bufnr)
        local gitsigns = require("gitsigns")

        -- Navigation through hunks
        vim.keymap.set("n", "]c", function()
          if vim.wo.diff then
            return "]c"
          end
          vim.schedule(function()
            gitsigns.nav_hunk("next")
          end)
          return "<Ignore>"
        end, { expr = true, buffer = bufnr, desc = "Jump to next hunk" })

        vim.keymap.set("n", "[c", function()
          if vim.wo.diff then
            return "[c"
          end
          vim.schedule(function()
            gitsigns.nav_hunk("prev")
          end)
          return "<Ignore>"
        end, { expr = true, buffer = bufnr, desc = "Jump to prev hunk" })

        -- Actions
        vim.keymap.set("n", "<leader>gs", function()
          gitsigns.stage_hunk()
        end, { buffer = bufnr, desc = "Stage hunk" })

        vim.keymap.set("n", "<leader>gr", function()
          gitsigns.reset_hunk()
        end, { buffer = bufnr, desc = "Reset hunk" })

        vim.keymap.set("n", "<leader>gP", function()
          gitsigns.preview_hunk()
        end, { buffer = bufnr, desc = "Preview hunk" })

        vim.keymap.set("n", "<leader>gb", function()
          gitsigns.blame_line()
        end, { buffer = bufnr, desc = "Blame line" })

        vim.keymap.set("n", "<leader>gp", function()
          gitsigns.preview_hunk_inline()
        end, { buffer = bufnr, desc = "Toggle deleted" })

        -- Visual mode mappings
        vim.keymap.set("v", "<leader>gs", function()
          gitsigns.stage_hunk({ vim.fn.line("."), vim.fn.line("v") })
        end, { buffer = bufnr, desc = "Stage selected range" })

        vim.keymap.set("v", "<leader>gu", function()
          gitsigns.stage_hunk({ vim.fn.line("."), vim.fn.line("v") })
        end, { buffer = bufnr, desc = "Undo stage hunk for selection" })
      end,
    },
    config = true,
  },
  {
    "NeogitOrg/neogit",
    cmd = "Neogit",
    opts = {
      mappings = {
        status = {
          ["]c"] = "GoToNextHunkHeader",
          ["[c"] = "GoToPreviousHunkHeader",
        },
      },
      commit_editor = {
        kind = "vsplit",
      },
    },
    keys = {
      {
        "<leader>gg",
        function()
          require("neogit").open()
        end,
        desc = "Open Neogit",
      },
    },
    dependencies = {
      "sindrets/diffview.nvim",
      config = true,
      cmd = { "DiffviewOpen", "DiffviewFileHistory" },
      keys = {
        {
          "<leader>gc",
          function()
            require("commands").compare_with()
          end,
          desc = "Compare with...",
        },
      },
    },
  },
}

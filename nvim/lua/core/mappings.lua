local M = {}

vim.g.mapleader = " "

M.window = {
  n = {
    ["<C-l>"] = { "<C-w>l", "Window right" },
    ["<C-h>"] = { "<C-w>h", "Window left" },
    ["<C-j>"] = { "<C-w>j", "Window up" },
    ["<C-k>"] = { "<C-w>k", "Window down" },
  },
}

M.general = {
  n = {
    ["<Esc>"] = { "<cmd>noh<CR>" },
  }
}

M.telescope = {
  plugin = true,
  n = {
    -- find
    ["<leader>ff"] = { "<cmd> Telescope find_files <CR>", "Find files" },
    ["<leader>fa"] = { "<cmd> Telescope find_files follow=true no_ignore=true hidden=true <CR>", "Find all" },
    ["<leader>fw"] = { "<cmd> Telescope live_grep <CR>", "Live grep" },
    ["<leader>fb"] = { "<cmd> Telescope buffers <CR>", "Find buffers" },
    ["<leader>fh"] = { "<cmd> Telescope help_tags <CR>", "Help page" },
    ["<leader>fo"] = { "<cmd> Telescope oldfiles <CR>", "Find oldfiles" },
    ["<leader>fz"] = { "<cmd> Telescope current_buffer_fuzzy_find <CR>", "Find in current buffer" },

    -- git
    ["<leader>gm"] = { "<cmd> Telescope git_commits <CR>", "Git commits (telescope)" },
    ["<leader>gt"] = { "<cmd> Telescope git_status <CR>", "Git status (telescope)" },

    -- pick a hidden term
    ["<leader>pt"] = { "<cmd> Telescope terms <CR>", "Pick hidden term" },

    ["<leader>ma"] = { "<cmd> Telescope marks <CR>", "telescope bookmarks" },
  },
}

M.lspconfig = {
  plugin = true,

  -- See `<cmd> :help vim.lsp.*` for documentation on any of the below functions

  n = {
    ["gD"] = {
      function()
        vim.lsp.buf.declaration()
      end,
      "LSP declaration",
    },

    ["C-]"] = {
      function()
        vim.lsp.buf.definition()
      end,
      "LSP definition",
    },

    ["K"] = {
      function()
        vim.lsp.buf.hover()
      end,
      "LSP hover",
    },

    ["gi"] = {
      function()
        vim.lsp.buf.implementation()
      end,
      "LSP implementation",
    },

    ["<leader>ls"] = {
      function()
        vim.lsp.buf.signature_help()
      end,
      "LSP signature help",
    },

    ["<leader>D"] = {
      function()
        vim.lsp.buf.type_definition()
      end,
      "Jumps to the definition of the type of the symbol under cursor",
    },

    ["<leader>rn"] = {
      function()
        vim.lsp.buf.rename()
      end,
      "LSP rename",
    },

    ["<leader>ca"] = {
      function()
        vim.lsp.buf.code_action()
      end,
      "LSP code action",
    },

    ["gr"] = {
      function()
        vim.lsp.buf.references()
      end,
      "LSP references",
    },

    ["<leader>e"] = {
      function()
        vim.diagnostic.open_float({ border = "rounded" })
      end,
      "Show diagnostic under cursor in floating window",
    },

    ["[d"] = {
      function()
        vim.diagnostic.goto_prev({ float = { border = "rounded" } })
      end,
      "Go to previous diagnostic",
    },

    ["]d"] = {
      function()
        vim.diagnostic.goto_next({ float = { border = "rounded" } })
      end,
      "Go to next diagnostic",
    },

    ["<leader>q"] = {
      function()
        vim.diagnostic.setloclist()
      end,
      "Diagnostic setloclist",
    },

    ["<leader>wa"] = {
      function()
        vim.lsp.buf.add_workspace_folder()
      end,
      "Add workspace folder",
    },

    ["<leader>wr"] = {
      function()
        vim.lsp.buf.remove_workspace_folder()
      end,
      "Remove workspace folder",
    },

    ["<leader>wl"] = {
      function()
        vim.lsp.buf.list_workspace_folders()
      end,
      "List workspace folders",
    },
    ["<leader>f"] = {
      function()
        require("conform").format()
      end,
      "Format file",
    },
  },
}

M.gitsigns = {
  plugin = true,

  n = {
    -- Navigation through hunks
    ["]c"] = {
      function()
        if vim.wo.diff then
          return "]c"
        end
        vim.schedule(function()
          require("gitsigns").next_hunk()
        end)
        return "<Ignore>"
      end,
      "Jump to next hunk",
      opts = { expr = true },
    },

    ["[c"] = {
      function()
        if vim.wo.diff then
          return "[c"
        end
        vim.schedule(function()
          require("gitsigns").prev_hunk()
        end)
        return "<Ignore>"
      end,
      "Jump to prev hunk",
      opts = { expr = true },
    },

    -- Actions
    ["<leader>gs"] = {
      function()
        require("gitsigns").stage_hunk()
      end,
      "Stage hunk",
    },
    ["<leader>gr"] = {
      function()
        require("gitsigns").reset_hunk()
      end,
      "Reset hunk",
    },

    ["<leader>gh"] = {
      function()
        require("gitsigns").preview_hunk()
      end,
      "Preview hunk",
    },

    ["<leader>gb"] = {
      function()
        package.loaded.gitsigns.blame_line()
      end,
      "Blame line",
    },

    ["<leader>gtd"] = {
      function()
      end,
      "Toggle deleted",
    },
  },
}

M.neogit = {
  plugin = true,
  n = {
    ["<leader>gg"] = {
      function()
        require("neogit").open()
      end,
      "Open Neogit",
    },
  },
}

M.trouble = {
  plugin = true,
  n = {
    ["<leader>xx"] = {
      function()
        require("trouble").open()
      end,
      "Open Trouble",
    },
    ["<leader>xw"] = {
      function()
        require("trouble").open("workspace_diagnostics")
      end,
      "Open workspace diagnostics",
    },
    ["<leader>xd"] = {
      function()
        require("trouble").open("document_diagnostics")
      end,
      "Open document diagnostics",
    },
    ["<leader>xq"] = {
      function()
        require("trouble").open("quickfix")
      end,
      "Open quickfix",
    },
    ["<leader>xl"] = {
      function()
        require("trouble").open("loclist")
      end,
      "Open location list",
    },
  },
}

M.mini_files = {
  plugin = true,
  n = {
    ["<leader>o"] = {
      function()
        require("mini.files").open()
      end,
      "Open mini.file file exporer"
    }
  }
}

return M

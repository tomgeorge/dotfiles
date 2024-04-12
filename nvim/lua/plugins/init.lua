local colorscheme = "rose-pine"

-- If you want to use another colorscheme that has fun lua stuff
local colorscheme_plugin_spec = require("colors").colorscheme_plugin_spec(colorscheme)

local plugins = {
  { "tpope/vim-unimpaired", lazy = false },
  { "vim-scripts/ReplaceWithRegister", event = "BufReadPost" },
  {
    "rcarriga/nvim-notify",
    init = function()
      vim.notify = require("notify")
    end,
    config = function()
      local notify = require("notify")
      notify.setup()
      vim.notify = notify
    end,
    event = "VeryLazy",
  },
  colorscheme_plugin_spec,
  {
    "nvim-telescope/telescope.nvim",
    tag = "0.1.2",
    dependencies = {
      "nvim-lua/plenary.nvim",
      {
        "nvim-telescope/telescope-fzf-native.nvim",
        build = "make",
      },
    },
    cmd = "Telescope",
    init = function()
      require("core.utils").load_mappings("telescope")
    end,
    config = function()
      local config = require("plugins.configs.telescope")
      require("telescope").setup(config)
      require("telescope").load_extension("notify")
    end,
  },
  {
    "rcarriga/nvim-notify",
    config = true,
    event = "VeryLazy",
  },
  {
    "numToStr/Comment.nvim",
    config = true,
    lazy = false,
  },
  {
    "hrsh7th/nvim-cmp",
    event = "InsertEnter",
    dependencies = {
      "hrsh7th/cmp-path",
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-nvim-lsp-signature-help",
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-nvim-lua",
      -- "PaterJason/cmp-conjure",
      "saadparwaiz1/cmp_luasnip",
      {
        "L3MON4D3/LuaSnip",
        dependencies = {
          "rafamadriz/friendly-snippets",
        },
        config = function()
          require("luasnip").setup()
          require("luasnip.loaders.from_vscode").lazy_load()
        end,
      },
      "onsails/lspkind.nvim",
    },
    opts = function()
      local cmp = require("cmp")
      local lspkind = require("lspkind")
      local luasnip = require("luasnip")

      return {
        snippet = {
          -- REQUIRED - you must specify a snippet engine
          expand = function(args)
            require("luasnip").lsp_expand(args.body) -- For `luasnip` users.
          end,
        },
        formatting = {
          format = lspkind.cmp_format({
            mode = "symbol_text",
            max_width = 50,
            ellipsis_char = "...",
          }),
        },
        window = {
          completion = cmp.config.window.bordered(),
          documentation = cmp.config.window.bordered(),
        },
        mapping = cmp.mapping.preset.insert({
          ["<C-n>"] = cmp.mapping(function(fallback)
            local function has_words_before()
              unpack = unpack or table.unpack
              local line, col = unpack(vim.api.nvim_win_get_cursor(0))
              return col ~= 0
                and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
            end
            if cmp.visible() then
              cmp.select_next_item()
            elseif luasnip.expand_or_jumpable() then
              luasnip.expand_or_jump()
            elseif has_words_before() then
              cmp.complete()
            else
              fallback()
            end
          end, { "i", "s" }),
          ["<C-p>"] = cmp.mapping(function(fallback)
            if cmp.visible() then
              cmp.select_prev_item()
            elseif luasnip.jumpable(-1) then
              luasnip.jump(-1)
            else
              fallback()
            end
          end, { "i", "s" }),
          ["<C-u>"] = cmp.mapping.scroll_docs(-4),
          ["<C-d>"] = cmp.mapping.scroll_docs(4),
          ["<C-Space>"] = cmp.mapping.complete(),
          ["<C-e>"] = cmp.mapping.abort(),
          -- Accept currently selected item. Set `select` to `false` to only confirm explicitly selected items.
          ["<CR>"] = cmp.mapping.confirm({ select = true }),
        }),
        sources = cmp.config.sources({
          { name = "nvim_lsp" },
          { name = "nvim_lua" },
          { name = "conjure" },
          { name = "luasnip" },
          { name = "buffer" },
          { name = "path" },
          { name = "buffer", keyword_length = 5 },
          { name = "nvim_lsp_signature_help" },
        }),
      }
    end,
  },
  -- {
  --   "Olical/conjure",
  --   ft = { "clojure" },
  --   config = function(_, opts)
  --     print("loading conjure for some reason")
  --     require("conjure.main").main()
  --     require("conjure.mapping")["on-filetype"]()
  --   end,
  --   dependencies = {
  --     "julienvincent/nvim-paredit"
  --     "tpope/vim-sexp-mappings-for-regular-people",
  --     "tpope/vim-repeat",
  --     "guns/vim-sexp",
  --     {
  --       "akinsho/toggleterm.nvim",
  --       version = "*",
  --       config = true,
  --     },
  --   },
  -- },
  {
    "clojure-vim/vim-jack-in",
    lazy = false,
    ft = "clojure",
    dependencies = {
      "tpope/vim-dispatch",
    },
  },
  {
    "akinsho/toggleterm.nvim",
    version = "*",
    config = true,
    opts = {
      direction = "float",
      open_mapping = [[<C-t>]],
    },
    event = "VeryLazy",
  },
  {
    "norcall/nvim-colorizer.lua",
    event = "BufReadPre",
    config = function()
      local config = require("plugins.configs.colorizer")
      require("colorizer").setup(config)
    end,
  },
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "aznhe21/actions-preview.nvim",
      config = function()
        require("actions-preview").setup({
          backend = { "nui", "telescope" },
        })
      end,
    },
    init = function()
      require("core.utils").lazy_load("nvim-lspconfig")
    end,
    config = function()
      require("plugins.configs.lspconfig")
    end,
  },
  {
    "stevearc/conform.nvim",
    event = "VeryLazy",
    config = function()
      require("conform").setup({
        formatters_by_ft = {
          lua = { "stylua" },
          go = { "gofmt", "goimports" },
          clojure = { "cljstyle" },
          terraform = { "terraform_fmt" },
        },
        format_on_save = {
          timeout_ms = 5000,
          lsp_fallback = true,
        },
      })
    end,
  },
  {
    "mfussenegger/nvim-lint",
    event = "VeryLazy",
    opts = {
      linters_by_ft = {
        go = { "golangcilint" },
        lua = { "luacheck" },
        sh = { "shellcheck" },
        clojure = { "clj-kondo" },
      },
    },
    config = function(_, opts)
      local lint = require("lint")
      lint.linters_by_ft = opts.linters_by_ft
      local group = vim.api.nvim_create_augroup("LintOnWrite", { clear = true })
      vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "InsertLeave" }, {
        group = group,
        callback = function()
          require("lint").try_lint()
        end,
      })
    end,
  },
  {
    "folke/neodev.nvim",
    lazy = false,
    dev = false,
  },
  {
    "nvim-lualine/lualine.nvim",
    dependencies = {
      "linrongbin16/lsp-progress.nvim",
    },
    opts = {
      options = {
        theme = colorscheme,
        component_separators = "",
        section_separators = "",
      },
      sections = {
        lualine_c = {
          {
            "filename",
            file_status = true,
            newfile_status = true,
            path = 1,
          },
        },
        lualine_x = {
          function()
            return require("plugins.configs.lualine").status_line()
          end,
          "filename",
        },
      },
    },
    lazy = false,
    config = true,
  },
  {
    "linrongbin16/lsp-progress.nvim",
    lazy = false,
    dependencies = { "nvim-tree/nvim-web-devicons" },
    init = function()
      -- listen lsp-progress event and refresh lualine
      vim.api.nvim_create_augroup("lualine_augroup", { clear = true })
      vim.api.nvim_create_autocmd("User LspProgressStatusUpdated", {
        group = "lualine_augroup",
        callback = require("lualine").refresh,
      })
    end,
    config = function()
      require("lsp-progress").setup()
    end,
  },
  {
    "echasnovski/mini.ai",
    config = function()
      local ai = require("mini.ai")
      require("mini.ai").setup({
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
    init = function()
      require("core.utils").load_mappings("mini_files")
    end,
  },
  {
    "echasnovski/mini.surround",
    event = "BufEnter",
    config = true,
  },
  {
    "echasnovski/mini.indentscope",
    version = false,
    event = { "BufReadPre", "BufNewFile" },
    opts = {
      symbol = "│",
      options = { true_as_border = true },
    },
    init = function()
      vim.api.nvim_create_autocmd("FileType", {
        pattern = {
          "help",
          "dashboard",
          "Trouble",
          "lazy",
          "toggleterm",
        },
        callback = function()
          vim.b.miniindentscope_disable = true
        end,
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter",
    dependencies = { "nvim-treesitter/nvim-treesitter-textobjects" },
    init = function()
      require("core.utils").lazy_load("nvim-treesitter")
    end,
    cmd = { "TSInstall", "TSBufEnable", "TSBufDisable", "TSModuleInfo" },
    build = ":TSUpdate",
    opts = require("plugins.configs.treesitter"),
    config = function(_, opts)
      require("nvim-treesitter.configs").setup(opts)
    end,
  },
  {
    "lewis6991/gitsigns.nvim",
    init = function()
      require("core.utils").lazy_load("gitsigns.nvim")
    end,
    opts = require("plugins.configs.gitsigns").gitsigns,
  },
  {
    "sindrets/diffview.nvim",
    config = true,
    cmd = { "DiffviewOpen", "DiffviewFileHistory" },
  },
  {
    "NeogitOrg/neogit",
    init = function()
      require("core.utils").load_mappings("neogit")
    end,
    cmd = "Neogit",
    opts = require("plugins.configs.neogit").opts,
    dependencies = {
      "sindrets/diffview.nvim",
    },
  },
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    init = function()
      vim.opt.timeout = true
      vim.opt.timeoutlen = 500
    end,
    config = function()
      local opts = require("plugins.configs.which-key").opts
      local triggers = require("plugins.configs.which-key").triggers
      local wk = require("which-key")

      wk.setup(opts)
      wk.register(triggers)
    end,
  },
  {
    "folke/trouble.nvim",
    branch = "dev",
    event = "VeryLazy",
    init = function()
      require("core.utils").load_mappings("trouble")
    end,
    config = function()
      require("plugins.configs.trouble").setup()
    end,
    dependencies = {
      "neovim/nvim-lspconfig",
      "nvim-tree/nvim-web-devicons",
    },
  },
  {
    "ellisonleao/glow.nvim",
    cmd = "Glow",
    config = true,
  },
  -- Stolen from LazyVim
  {
    "stevearc/dressing.nvim",
    init = function()
      ---@diagnostic disable-next-line
      vim.ui.select = function(...)
        require("lazy").load({ plugins = { "dressing.nvim" } })
        return vim.ui.select(...)
      end
      ---@diagnostic disable-next-line
      vim.ui.input = function(...)
        require("lazy").load({ plugins = { "dressing.nvim" } })
        return vim.ui.input(...)
      end
    end,
  },
  {
    "rcarriga/nvim-dap-ui",
    dependencies = {
      {
        "mfussenegger/nvim-dap",
        init = function()
          require("core.utils").load_mappings("dap")
        end,
      },
      {
        "leoluz/nvim-dap-go",
        config = function()
          require("dap-go").setup({

            dap_configurations = {
              {
                type = "go",
                name = "Attach remote (port 43000)",
                mode = "remote",
                request = "attach",
                connect = {
                  host = "127.0.0.1",
                  port = "43000",
                },
              },
            },
            delve = {
              port = "43000",
            },
          })
        end,
      },
      {
        "theHamsta/nvim-dap-virtual-text",
        config = true,
      },
      { "nvim-neotest/nvim-nio" },
    },
    event = "VeryLazy",
    config = function()
      require("dapui").setup()
      local dap, dapui = require("dap"), require("dapui")
      dap.listeners.after.event_initialized["dapui_config"] = function()
        dapui.open()
      end
    end,
  },
  {
    "go-test.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
    dev = true,
    config = true,
    lazy = false,
  },
}

local lazy_config = require("core.config").lazy_nvim
require("lazy").setup(plugins, lazy_config)

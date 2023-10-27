local colorscheme = "gruvbox-material"

-- If you want to use another colorscheme that has fun lua stuff
-- local colorscheme_plugin_spec = require("colors").colorscheme_plugin_spec(colorscheme)

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
  {
    "sainnhe/gruvbox-material",
    lazy = false,
    priority = 1000,
    config = function()
      vim.opt.background = "dark"
      vim.g.gruvbox_material_background = "soft"
      vim.cmd("colorscheme gruvbox-material")
    end,
  },
  -- colorscheme_plugin_spec,
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
            print("hey")
            if cmp.visible() then
              print("cmp.visible()")
              cmp.select_prev_item()
            elseif luasnip.jumpable(-1) then
              print("luasnip jumpable")
              luasnip.jump(-1)
            else
              print("fallback")
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
          { name = "luasnip" },
          { name = "buffer" },
          { name = "path" },
          { name = "buffer", keyword_length = 5 },
          { name = "nvim_lsp_signature_help" },
        }),
      }
    end,
  },
  {
    "norcalli/nvim-colorizer.lua",
    event = "BufReadPre",
    config = function()
      local config = require("plugins.configs.colorizer")
      require("colorizer").setup(config)
    end,
  },
  {
    "neovim/nvim-lspconfig",
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
        },
        format_on_save = {
          timeout_ms = 500,
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
          "require('lsp-progress').progress()",
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
      local spec_treesitter = require("mini.ai").gen_spec.treesitter
      require("mini.ai").setup({
        mappings = {
          goto_left = "g[",
          goto_right = "g]",
        },
        custom_textobjects = {
          F = spec_treesitter({ a = "@function.outer", i = "@function_innter" }),
        },
      })
    end,
    lazy = false,
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
      print("lazy loading treesitter")
      require("core.utils").lazy_load("nvim-treesitter")
    end,
    cmd = { "TSInstall", "TSBufEnable", "TSBufDisable", "TSModuleInfo" },
    build = ":TSUpdate",
    opts = require("plugins.configs.treesitter"),
    config = function(_, opts)
      print("treesitter opts are " .. vim.inspect(opts))
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
    cmd = "DiffviewOpen",
  },
  {
    "NeogitOrg/neogit",
    init = function()
      require("core.utils").load_mappings("neogit")
    end,
    cmd = "Neogit",
    opts = require("plugins.configs.neogit").opts,
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
    event = "VeryLazy",
    init = function()
      print("trouble.init")
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
        config = true,
      },
      {
        "theHamsta/nvim-dap-virtual-text",
        config = true,
      },
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

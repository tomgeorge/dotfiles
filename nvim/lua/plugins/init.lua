local colorscheme = "catppuccin"
local colorscheme_plugin_spec = require("colors").colorscheme_plugin_spec(colorscheme)

local plugins = {
  { "tpope/vim-unimpaired", lazy = false },
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
    end,
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
      "L3MON4D3/LuaSnip",
    },
    opts = function()
      local cmp = require("cmp")
      return {
        snippet = {
          -- REQUIRED - you must specify a snippet engine
          expand = function(args)
            require("luasnip").lsp_expand(args.body) -- For `luasnip` users.
          end,
        },
        formatting = {
          max_width = 0,
          source_names = {
            nvim_lsp = "[LSP]",
            path = "[Path]",
            luasnip = "[Snippet]",
            buffer = "[Buffer]",
          },
        },
        window = {
          completion = cmp.config.window.bordered(),
          documentation = cmp.config.window.bordered(),
        },
        mapping = cmp.mapping.preset.insert({
          ["<C-b>"] = cmp.mapping.scroll_docs(-4),
          ["<C-f>"] = cmp.mapping.scroll_docs(4),
          ["<C-Space>"] = cmp.mapping.complete(),
          ["<C-e>"] = cmp.mapping.abort(),
          ["<CR>"] = cmp.mapping.confirm({ select = true }), -- Accept currently selected item. Set `select` to `false` to only confirm explicitly selected items.
        }),
        sources = cmp.config.sources({
          { name = "nvim_lsp" },
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
    "creativenull/efmls-configs-nvim",
    version = "v1.x.x",
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
      theme = colorscheme,
      sections = {
        lualine_c = {
          "require('lsp-progress').progress()",
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
    "nvim-treesitter/nvim-treesitter",
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
    "NeogitOrg/neogit",
    init = function()
      require("core.utils").load_mappings("neogit")
    end,
    dependencies = "sindrets/diffview.nvim",
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
      require("plugins.configs.trouble").setup_autocmd()
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
}

local lazy_config = require("core.config").lazy_nvim
require("lazy").setup(plugins, lazy_config)
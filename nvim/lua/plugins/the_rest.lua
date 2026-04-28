return {
  {
    "numToStr/Comment.nvim",
    config = true,
    lazy = false,
  },
  -- {
  --   "neovim/nvim-lspconfig",
  --   dependencies = {
  --     "aznhe21/actions-preview.nvim",
  --     enabled = false,
  --     opts = {
  --       backend = { "snacks" },
  --     },
  --   },
  --   init = function()
  --     require("utils").lazy_load("nvim-lspconfig")
  --   end,
  --   config = function()
  --     require("plugins.configs.lspconfig")
  --   end,
  -- },
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
          sh = { "shfmt" },
          fish = { "fish_indent" },
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
        bash = { "shellcheck" },
        zsh = { "shellcheck" },
        fish = { "fish" },
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
          local ignore_repositories = { "karpenter" }
          local should_ignore = function(path)
            for _, ignore in ipairs(ignore_repositories) do
              if string.find(path, ignore) then
                return true
              end
              return false
            end
          end

          if should_ignore(vim.fn.getcwd()) then
            return
          end
          require("lint").try_lint()
        end,
      })
    end,
  },
  {
    "nvim-lualine/lualine.nvim",
    enabled = false,
    dependencies = {
      "linrongbin16/lsp-progress.nvim",
    },
    opts = {
      options = {
        -- theme = colorscheme,
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
}

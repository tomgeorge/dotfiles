-- install packer automatically on new system
-- https://github.com/wbthomason/packer.nvim#bootstrapping
local fn = vim.fn
local install_path = fn.stdpath("data") .. "/site/pack/packer/start/packer.nvim"

if fn.empty(fn.glob(install_path)) > 0 then
	print("Installing packer...")
	PACKER_BOOTSTRAP = fn.system({
		"git",
		"clone",
		"--depth",
		"1",
		"https://github.com/wbthomason/packer.nvim",
		install_path,
	})
end

-- sync plugins on write/save
vim.api.nvim_create_augroup("SyncPackerPlugins", {})
vim.api.nvim_create_autocmd(
	"BufWritePost",
	{ command = "source <afile> | PackerSync", pattern = "plugins.lua", group = "SyncPackerPlugins" }
)

return require("packer").startup({
	function(use)
		use({ "wbthomason/packer.nvim" })

		use({ "lewis6991/impatient.nvim" })

		-- [[
		-- Tools
		-- Completion, editing, etc
		-- ]]
		use({ "tpope/vim-fugitive" })
		use({ "tpope/vim-unimpaired" })

		use({
			"neovim/nvim-lspconfig",
			config = function()
				require("modules.completion.config").lspconfig()
			end,
		})

		use({
			"hrsh7th/nvim-cmp",
			-- event = 'InsertEnter',
			config = function()
				require("modules.completion.config").nvim_cmp()
			end,
			wants = { "LuaSnip" },
			requires = {
				{ "hrsh7th/cmp-path", after = "nvim-cmp" },
				{ "hrsh7th/cmp-buffer", after = "nvim-cmp" },
				{ "PaterJason/cmp-conjure", after = "nvim-cmp" },
				{ "hrsh7th/cmp-nvim-lsp-signature-help" },
				{ "saadparwaiz1/cmp_luasnip", after = "LuaSnip" },
			},
		})

		use({
			"hrsh7th/cmp-nvim-lsp",
			after = "nvim-cmp",
			module = "cmp_nvim_lsp",
		})

		use({
			"jose-elias-alvarez/null-ls.nvim",
			requires = "nvim-lua/plenary.nvim",
			config = function()
				require("modules.tools.null-ls-nvim")
			end,
		})

		use({ "rafamadriz/friendly-snippets", event = "BufEnter" })

		use({
			"L3MON4D3/LuaSnip",
			event = "InsertEnter",
			config = function()
				require("modules.completion.config").lua_snip()
			end,
		})

		use({
			"nvim-treesitter/nvim-treesitter",
			run = ":TSUpdate",
			after = "telescope.nvim",
			config = function()
				require("modules.lang.config").nvim_treesitter()
			end,
			requires = {
				{ "andymass/matchup.vim" },
				{ "JoosepAlviste/nvim-ts-context-commentstring" },
				{ "p00f/nvim-ts-rainbow" },
			},
		})

		use({
			"nvim-treesitter/nvim-treesitter-textobjects",
			after = "nvim-treesitter",
		})

		use({
			"simrat39/symbols-outline.nvim",
			cmd = "SymbolsOutline",
			config = function()
				require("symbols-outline").setup()
			end,
		})

		use({
			"kyazdani42/nvim-tree.lua",
			requires = {
				"kyazdani42/nvim-web-devicons", -- optional, for file icons
			},
			cmd = { "NvimTreeToggle", "NvimTreeFocus" },
			config = function()
				require("modules.tools.nvim-tree.config").setup()
			end,
			tag = "nightly", -- optional, updated every week. (see issue #1193)
		})

		use({
			"folke/which-key.nvim",
			config = function()
				require("modules.tools.which-key.config")
			end,
		})

		use({
			"gpanders/editorconfig.nvim",
			event = "BufEnter",
		})

		use({
			"sudormrfbin/cheatsheet.nvim",
			after = "telescope.nvim",
			cmd = "Cheatsheet",
			requres = {
				{ "nvim-telescope/telescope.nvim" },
				{ "nvim-lua/popup.nvim" },
				{ "nvim-lua/plenary.nvim" },
			},
		})

		use({
			"TimUntersberger/neogit",
			config = function()
				require("modules.tools.neogit.config").setup()
			end,
			requires = { { "nvim-lua/plenary.nvim" }, { "sindrets/diffview.nvim" } },
		})

		use({
			"folke/trouble.nvim",
			cmd = "TroubleToggle",
			required = "kyazdani42/nvim-web-devicons",
			config = function()
				require("modules.ui.trouble")
			end,
		})

		use({
			"numToStr/Comment.nvim",
			requres = "JoosepAlviste/nvim-ts-context-commentstring",
			config = function()
				require("modules.tools.Comment.config").setup()
			end,
		})

		use({ "JoosepAlviste/nvim-ts-context-commentstring" })

		use({
			"sindrets/diffview.nvim",
			requires = "nvim-lua/plenary.nvim",
			module = "diffview",
		})

		-- [[
		-- UI Customization
		-- ]]

		use({
			"EdenEast/nightfox.nvim",
			-- config = require('modules.ui.config').nordfox,
		})

		use({
			"marko-cerovac/material.nvim",
			-- config = require('modules.ui.config').material,
		})

		use({
			"monsonjeremy/onedark.nvim",
			-- config = function()
			--   require("modules.ui.config").onedark()
			-- end,
		})

		use({
			"sam4llis/nvim-tundra",
      -- config = function()
      --   require("modules.ui.config").tundra()
      -- end
		})

		use({
			"catppuccin/nvim",
			as = "catppuccin",
			config = function()
			  require('modules.ui.config').catppuccin()
			end
		})

		use({
			"glepnir/galaxyline.nvim",
			branch = "main",
			config = require("modules.ui.config").galaxyline,
			requires = "kyazdani42/nvim-web-devicons",
		})

		use({
			"akinsho/nvim-bufferline.lua",
			config = require("modules.ui.config").nvim_bufferline,
			requires = "kyazdani42/nvim-web-devicons",
		})

		use({
			"j-hui/fidget.nvim",
			config = function()
				require("fidget").setup({})
			end,
		})

		use({
			"onsails/lspkind.nvim",
			requires = "hrsh7th/nvim-cmp",
		})

		use({
			"rcarriga/nvim-notify",
			event = "VimEnter",
			config = function()
				vim.notify = require("notify")
			end,
		})

		use({
			"benfowler/telescope-luasnip.nvim",
			module = "telescope._extensions.luasnip", -- if you wish to lazy-load
		})

		use({
			"nvim-telescope/telescope.nvim",
			config = function()
				require("modules.tools.config").telescope()
			end,
			requires = {
				{ "nvim-lua/popup.nvim" },
				{ "nvim-lua/plenary.nvim" },
				{ "nvim-telescope/telescope-fzy-native.nvim" },
				{ "nvim-telescope/telescope-ui-select.nvim" },
			},
		})

		use({
			"lewis6991/gitsigns.nvim",
			event = "BufRead",
			config = function()
				require("gitsigns").setup()
			end,
		})

		use({
			"lukas-reineke/indent-blankline.nvim",
			event = "BufRead",
			config = function()
				require("modules.ui.indent-blankline-nvim")
			end,
		})

		use({
			"windwp/nvim-autopairs",
			event = "InsertEnter",
			config = function()
				require("modules.tools.nvim-autopairs")
			end,
		})

		use({
			"kosayoda/nvim-lightbulb",
			requires = "antoinemadec/FixCursorHold.nvim",
		})

		-- [[
		-- Language-Specific
		-- ]]
		use({
			"hashivim/vim-terraform",
			event = "BufEnter",
		})

		use({
			"Olical/conjure",
		})

		use({
			"clojure-vim/vim-jack-in",
			requires = {
				"radenling/vim-dispatch-neovim",
				"tpope/vim-dispatch",
			},
		})

		use({
			"tpope/vim-sexp-mappings-for-regular-people",
			requires = {
				"guns/vim-sexp",
				"tpope/vim-surround",
				"tpope/vim-repeat",
			},
		})
	end,
	config = {
		display = {
			open_fn = require("packer.util").float,
		},
	},
})

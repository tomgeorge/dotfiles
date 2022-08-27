local config = {}

function config.telescope()
  if not packer_plugins['plenary.nvim'].loaded then
    vim.cmd([[packadd plenary.nvim]])
    vim.cmd([[packadd popup.nvim]])
    vim.cmd([[packadd telescope-fzy-native.nvim]])
    vim.cmd([[packadd telescope-file-browser.nvim]])
  end
  require('telescope').setup({
    defaults = {
      layout_config = {
        horizontal = { prompt_position = 'top', results_width = 0.6 },
        vertical = { mirror = false },
      },
      sorting_strategy = 'ascending',
      file_previewer = require('telescope.previewers').vim_buffer_cat.new,
      grep_previewer = require('telescope.previewers').vim_buffer_vimgrep.new,
      qflist_previewer = require('telescope.previewers').vim_buffer_qflist.new,
    },
    extensions = {
      fzy_native = {
        override_generic_sorter = false,
        override_file_sorter = true,
      },
      ui_select = {
        require('telescope.themes').get_dropdown{}
      },
    },
  })
  require('telescope').load_extension('fzy_native')
  require('telescope').load_extension('luasnip')
  require('telescope').load_extension('ui-select')
  require('telescope').load_extension('notify')
end

function config.search_neovim_configuration()
  local opts = {
    prompt_title = "Search Neovim Configuration Files",
    shorten_path = false,
    cwd = "~/.config/nvim",
    layout_strategy = "flex"
  }
  require('telescope.builtin').live_grep(opts)
end

return config

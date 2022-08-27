local keymap = require('core.keymap')
local nmap, imap, cmap, xmap = keymap.nmap, keymap.imap, keymap.cmap, keymap.xmap
local silent, noremap = keymap.silent, keymap.noremap
local opts = keymap.new_opts
local cmd = keymap.cmd

local default_opts = opts(noremap, silent)

-- Use space as leader key
vim.g.mapleader = ','

-- leaderkey
-- nmap({ ' ', '', opts(noremap) })
-- xmap({ ' ', '', opts(noremap) })

-- usage example
nmap({
  -- noremal remap
  -- close buffer
  { '<C-x>k', cmd('bdelete'), opts(noremap, silent) },
  { '<leader>fh', cmd('Telescope help_tags'), opts(noremap, silent) },

  -- Nvim Tree
  { '<F8>', cmd('NvimTreeToggle'), default_opts },
  -- save
  { '<C-s>', cmd('write'), opts(noremap) },
  -- yank
  { 'Y', 'y$', opts(noremap) },
  -- buffer jump
  { ']b', cmd('bn'), opts(noremap) },
  { '[b', cmd('bp'), opts(noremap) },
  -- remove trailing white space
  { '<Leader>t', cmd('TrimTrailingWhitespace'), opts(noremap) },
  -- window jump
  { '<C-h>', '<C-w>h', opts(noremap) },
  { '<C-l>', '<C-w>l', opts(noremap) },
  { '<C-j>', '<C-w>j', opts(noremap) },
  { '<C-k>', '<C-w>k', opts(noremap) },
  -- Telescope
  { '<Leader>b', cmd('Telescope buffers'), opts(noremap, silent) },
  { '<Leader>fa', cmd('Telescope live_grep'), opts(noremap, silent) },
  { '<Leader>ff', cmd('Telescope find_files'), opts(noremap, silent) },
  { '<Leader>en', cmd("lua require('modules.tools.config').search_neovim_configuration()"), default_opts },
  -- Custom commands
  { '<Leader>h', cmd('CurrentBufGitHistory'), default_opts },
  -- Neogit
  { '<Leader>g', cmd('Neogit'), default_opts },
  -- Trouble
  { '<Leader>t', cmd('TroubleToggle'), default_opts },
})

imap({
  -- insert mode
  { '<C-h>', '<Bs>', opts(noremap) },
  { '<C-e>', '<End>', opts(noremap) },
})

-- commandline remap
cmap({ '<C-b>', '<Left>', opts(noremap) })

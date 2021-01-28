set runtimepath^=~/.vim runtimepath+=~/.vim/after

syntax on
filetype plugin indent on

call plug#begin('~/.vim/plugged')
" =================
" Colorschemes {{{
" =================
Plug 'flazz/vim-colorschemes'
Plug 'gregsexton/Muon'
Plug 'jacoborus/tender.vim'
Plug 'arcticicestudio/nord-vim'
Plug 'sainnhe/edge'
Plug 't184256/vim-boring'
Plug 'rakr/vim-one'
" }}}

" Skinning 
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'edkolev/tmuxline.vim'
Plug 'kien/rainbow_parentheses.vim'

" Git stuff
Plug 'tpope/vim-fugitive'
Plug 'airblade/vim-gitgutter'
Plug 'gregsexton/gitv'

" Utilities
Plug 'tpope/vim-surround'
Plug 'majutsushi/tagbar'
Plug 'christoomey/vim-tmux-navigator'
Plug 'scrooloose/nerdTree'
Plug 'kyazdani42/nvim-web-devicons' 
Plug 'kyazdani42/nvim-tree.lua'
Plug 'nvim-lua/popup.nvim'
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-unimpaired'
Plug 'tweekmonster/startuptime.vim'

" ECMAScript-y langs
Plug 'pangloss/vim-javascript'
Plug 'posva/vim-vue'

" JVM-based langs
" Plug 'tpope/vim-fireplace'
Plug 'guns/vim-sexp'
Plug 'guns/vim-clojure-highlight'
Plug 'guns/vim-clojure-static'
Plug 'tpope/vim-sexp-mappings-for-regular-people'

Plug 'bakpakin/fennel.vim'

Plug 'ekalinin/Dockerfile.vim'

Plug 'fatih/vim-go'
Plug 'neovim/nvim-lspconfig'
Plug 'nvim-lua/completion-nvim'
Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins', 'for': 'clojure' } " I really only want deoplete for things that aren't LSP
Plug 'neomake/neomake', {'for': 'clojure'} " neomake for things that aren't LSP (maybe?)
Plug 'nvim-lua/lsp-status.nvim'
Plug 'liuchengxu/vista.vim'
Plug 'liuchengxu/vim-clap', { 'do': ':Clap install-binary!' }
" Plug 'Olical/conjure', {'tag': 'v4.11.0'}
Plug '/home/tgeorge/git/conjure'
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}  " We recommend updating the parsers on update
Plug 'norcalli/snippets.nvim'
Plug 'eraserhd/parinfer-rust', {'do':
        \  'cargo build --release'}
Plug 'kassio/neoterm'
call plug#end()

set nocompatible
set guifont=Monaco\ 11
set wildmenu wildmode=full wildchar=<Tab>
set shiftwidth=2
set tabstop=2
set expandtab
set previewheight=8
set guicursor= 
set nohlsearch
set number
set ruler
set incsearch
set ignorecase
set smartcase
set backspace=indent,eol,start
set smartindent
set laststatus=2
set ttimeoutlen=50
set relativenumber
set cursorline
set t_ut=
set lazyredraw
set ttyfast
set noswapfile
set noerrorbells visualbell t_vb=
" Echodoc
set cmdheight=2
" You will have bad experience for diagnostic messages when it's default 4000.
set updatetime=300
" don't give |ins-completion-menu| messages.
set shortmess+=c
" always show signcolumns
set signcolumn=yes
set termguicolors
" Set completeopt to have a better completion experience
set completeopt=menuone,noinsert,noselect
set hidden
" Some servers have issues with backup files, see #649
set nobackup
set nowritebackup

let g:ale_disable_lsp = 1
let mapleader = ","
let maplocalleader = " "
let g:go_def_mode='gopls'
let g:go_info_mode='gopls'
let g:rbpt_colorpairs = [
    \ ['brown',       'RoyalBlue3'],
    \ ['Darkblue',    'SeaGreen3'],
    \ ['darkgray',    'DarkOrchid3'],
    \ ['darkgreen',   'firebrick3'],
    \ ['darkcyan',    'RoyalBlue3'],
    \ ['darkred',     'SeaGreen3'],
    \ ['darkmagenta', 'DarkOrchid3'],
    \ ['brown',       'firebrick3'],
    \ ['gray',        'RoyalBlue3'],
    \ ['black',       'SeaGreen3'],
    \ ['darkmagenta', 'DarkOrchid3'],
    \ ['Darkblue',    'firebrick3'],
    \ ['darkgreen',   'RoyalBlue3'],
    \ ['darkcyan',    'SeaGreen3'],
    \ ['darkred',     'DarkOrchid3'],
    \ ['red',         'firebrick3'],
    \ ]
let g:rbpt_max = 16
let g:rbpt_loadcmd_toggle = 0
let g:ackprg = 'ag --nogroup --nocolor --column'
let g:paredit_electric_return=0
let g:airline#extensions#bufferline#enabled = 1
let g:airline#extensions#tabline#enabled = 1
let g:go_highlight_functions = 1
let g:go_highlight_function_calls = 1
let g:go_highlight_fields = 1
let g:go_highlight_extra_types = 1
let g:go_highlight_types = 1
let g:airline#extensions#tabline#enabled = 0
let g:go_def_mapping_enabled = 0
let g:go_doc_keywordprg_enabled = 0

au VimEnter *.clj RainbowParenthesesToggle
au Syntax * RainbowParenthesesLoadRound
au Syntax * RainbowParenthesesLoadSquare
au Syntax * RainbowParenthesesLoadBraces
autocmd BufRead, BufNewFile Jenkinsfile set syntax=groovy
autocmd BufEnter, BufNewFile Jenkinsfile set syntax=groovy
autocmd GUIEnter * set visualbell t_vb=

colorscheme one

tnoremap <Esc> <C-\><C-n>
nnoremap ss <C-w>s
nnoremap wv <C-w>v
nnoremap <Right> <Esc>:bn<Return>
nnoremap <Left> <Esc>:bp<Return>
nnoremap <Tab> <C-w>w
nnoremap H  ^
nnoremap L $
nnoremap <C-tab> 	:tabn<CR>
nnoremap <Leader>z :Eval<cr>
nnoremap <silent><F8> :NERDTreeToggle<CR>
nnoremap <silent><Leader>nt :NERDTreeToggle<CR>
nnoremap <silent><Leader>tb :TagbarToggle<CR>
nnoremap <silent><F9> :TagbarToggle<CR>
nnoremap <C-p> <cmd>Telescope find_files<cr>
nnoremap <Leader>f <cmd>Telescope live_grep<CR>
nnoremap <Leader>b :Buffers<CR>
inoremap <expr> <Tab>   pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"
" Find files using Telescope command-line sugar.
nnoremap <leader>ff <cmd>Telescope find_files<cr>
nnoremap <leader>fg <cmd>Telescope live_grep<cr>
nnoremap <leader>fb <cmd>Telescope buffers<cr>
nnoremap <leader>fh <cmd>Telescope help_tags<cr>


function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

lua require('my_lspconfig')
lua require('lsp_statusline')
lua require('treesitter_config')
lua require('conjure_completion')


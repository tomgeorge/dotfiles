set nocompatible
filetype off
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
Plugin 'tpope/vim-fugitive'
Plugin 'tpope/vim-classpath'
Plugin 'kien/rainbow_parentheses.vim'
Plugin 'flazz/vim-colorschemes'
Plugin 'gregsexton/Muon'
Plugin 'tpope/vim-fireplace'
Plugin 'vim-airline/vim-airline'
Plugin 'vim-airline/vim-airline-themes'
Plugin 'guns/vim-sexp'
Plugin 'tpope/vim-sexp-mappings-for-regular-people'
Plugin 'tpope/vim-repeat'
Plugin 'tpope/vim-surround'
Plugin 'airblade/vim-gitgutter'
Plugin 'kien/ctrlp.vim'
Plugin 'ervandew/supertab'
Plugin 'bling/vim-bufferline'
Plugin 'edkolev/tmuxline.vim'
Plugin 'majutsushi/tagbar'
Plugin 'ingydotnet/yaml-vim'
Plugin 'vim-scripts/Solarized'
Plugin 'scrooloose/nerdTree'
execute pathogen#infect()
syntax on
filetype plugin indent on
set t_Co=256

set guifont=Monaco\ 11
let g:Powerline_symbols='fancy'
set wildmenu wildmode=full wildchar=<Tab>

set shiftwidth=4
set tabstop=4
" colorscheme vividchalk
" set background=dark
if has('gui_running')
	set background=dark
	colorscheme solarized
	set guioptions -=m
	set guioptions -=T
else
	colorscheme muon
endif
se nu
set ruler

let mapleader = ","
set incsearch
set ignorecase
set smartcase
nnoremap ss <C-w>s
nnoremap wv <C-w>v
nnoremap <Right> <Esc>:bn<Return>
nnoremap <Left> <Esc>:bp<Return>
nnoremap <Tab> <C-w>w
nnoremap H  ^
nnoremap L $
nnoremap <C-tab> 	:tabn<CR>
" let g:miniBufExplorerAutoStart = 1
" map <Leader>b :MBEFocus<cr>
" let g:miniBufExplBuffersNeeded = 1

let g:ctrlp_map = '<c-p>'
let g:ctrlp_command = 'CtrlP'
let g:ctrlp_switch_buffer='Et'
let g:ctrlp_use_caching = 1
let g:ctrlp_show_hidden = 1
let g:ctrlp_clear_cache_on_exit = 0

nnoremap <Leader>z :Eval<cr>

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
au VimEnter *.clj RainbowParenthesesToggle
au BufEnter *.pcc set syntax=c
au BufEnter *.pc set syntax=c
au Syntax * RainbowParenthesesLoadRound
au Syntax * RainbowParenthesesLoadSquare
au Syntax * RainbowParenthesesLoadBraces
au Syntax * RainbowParenthesesToggle

nnoremap <silent><F8> :NERDTreeToggle<CR>
nnoremap <silent><F9> :TagbarToggle<CR>


let g:ackprg = 'ag --nogroup --nocolor --column'
let g:paredit_electric_return=0

set backspace=indent,eol,start
autocmd BufRead, BufNewFile *.cljs setlocal filetype=clojure


let g:slime_target="tmux"
set noswapfile
set noerrorbells visualbell t_vb=
autocmd GUIEnter * set visualbell t_vb=

set laststatus=2
set ttimeoutlen=50

set relativenumber
set cursorline
set t_ut=

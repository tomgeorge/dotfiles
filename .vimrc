set nocompatible
execute pathogen#infect()
syntax on
filetype plugin indent on

set guifont=Terminus\ 12
set wildmenu wildmode=full wildchar=<Tab>

colorscheme zenburn

se nu
set ruler

let mapleader = ","
set incsearch
nnoremap ss <C-w>s
nnoremap wv <C-w>v
nnoremap <Right> <Esc>:bn<Return>
nnoremap <Left> <Esc>:bp<Return>
nnoremap <Tab> <C-w>w

let g:miniBufExplorerAutoStart = 1
map <Leader>b :MBEFocus<cr>
let g:miniBufExplBuffersNeeded = 1

let g:ctrlp_map = '<c-p>'
let g:ctrlp_command = 'CtrlP'

nnoremap <Leader>z :Eval<cr>
set guioptions -=m

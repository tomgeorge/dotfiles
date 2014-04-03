set nocompatible
execute pathogen#infect()
syntax on
filetype plugin indent on
set t_Co=256

set guifont=Monaco\ 12
let g:Powerline_symbols='fancy'
set wildmenu wildmode=full wildchar=<Tab>

set shiftwidth=2
set tabstop=2
" colorscheme zenburn
" colorscheme vividchalk
" set background=dark
if has('gui_running')
	colorscheme solarized
else
	colorscheme ir_black
endif
se nu
set ruler

let mapleader = ","
set background=dark
set incsearch
nnoremap ss <C-w>s
nnoremap wv <C-w>v
nnoremap <Right> <Esc>:bn<Return>
nnoremap <Left> <Esc>:bp<Return>
nnoremap <Tab> <C-w>w
nnoremap H  ^
nnoremap L $
let g:miniBufExplorerAutoStart = 1
map <Leader>b :MBEFocus<cr>
let g:miniBufExplBuffersNeeded = 1

let g:ctrlp_map = '<c-p>'
let g:ctrlp_command = 'CtrlP'

nnoremap <Leader>z :Eval<cr>
set guioptions -=m
set guioptions -=T

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
au Syntax * RainbowParenthesesLoadRound
au Syntax * RainbowParenthesesLoadSquare
au Syntax * RainbowParenthesesLoadBraces
au Syntax * RainbowParenthesesToggle

nnoremap <silent><F8> :NERDTreeToggle<CR>
nnoremap <silent><F9> :TagbarToggle<CR>

let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0
let g:syntastic_aggregate_errors = 1
let g:syntastic_error_symbol = '✗'
let g:syntastic_warning_symbol = '⚠'
let g:syntastic_enable_balloons = 1
let g:syntastic_always_populate_loc_list = 1

let g:ackprg = 'ag --nogroup --nocolor --column'

set backspace=indent,eol,start
autocmd BufRead, BufNewFile *.cljs setlocal filetype=clojure
let g:paredit_electric_return=0


let g:slime_target="tmux"
set noswapfile
set noerrorbells visualbell t_vb=
autocmd GUIEnter * set visualbell t_vb=

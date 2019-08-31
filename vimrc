set nocompatible
filetype off
set rtp+=~/.vim/bundle/Vundle.vim

call vundle#begin()

" =================
" Colorschemes {{{
" =================
Plugin 'flazz/vim-colorschemes'
Plugin 'gregsexton/Muon'
Plugin 'jacoborus/tender.vim'
Plugin 'arcticicestudio/nord-vim'
" }}}

" Skinning 
Plugin 'vim-airline/vim-airline'
Plugin 'vim-airline/vim-airline-themes'
Plugin 'edkolev/tmuxline.vim'
Plugin 'kien/rainbow_parentheses.vim'

" Git stuff
Plugin 'tpope/vim-fugitive'
Plugin 'airblade/vim-gitgutter'
Plugin 'gregsexton/gitv'

" Utilities
Plugin 'mileszs/ack.vim'
Plugin 'tpope/vim-repeat'
Plugin 'tpope/vim-surround'
Plugin 'majutsushi/tagbar'
Plugin 'christoomey/vim-tmux-navigator'
Plugin 'scrooloose/nerdTree'
Plugin 'junegunn/fzf.vim'
Plugin 'tpope/vim-commentary'
Plugin 'tpope/vim-unimpaired'

" ECMAScript-y langs
Plugin 'leafgarland/typescript-vim'
Plugin 'pangloss/vim-javascript'
Plugin 'othree/javascript-libraries-syntax.vim'
Plugin 'clausreinke/typescript-tools.vim'
Plugin 'posva/vim-vue'

" Writing
Plugin 'junegunn/goyo.vim'
Plugin 'junegunn/limelight.vim'

" JVM-based langs
"Plugin 'tpope/vim-classpath'
"Plugin 'tpope/vim-fireplace'
"Plugin 'guns/vim-sexp'
"Plugin 'tpope/vim-sexp-mappings-for-regular-people'

"Plugin 'chase/vim-ansible-yaml'
Plugin 'ekalinin/Dockerfile.vim'

Plugin 'fatih/vim-go'
"Plugin 'stamblerre/gocode', {'rtp': 'vim/'}
call vundle#end()
call plug#begin('~/.vim/plugged')
Plug 'autozimu/LanguageClient-neovim', {
    \ 'branch': 'next',
    \ 'do': 'bash install.sh',
    \ }
call plug#end()
"let g:go_def_mode='gopls'
"let g:go_info_mode='gopls'

syntax on
filetype plugin indent on

let g:airline#extensions#bufferline#enabled = 1
let g:airline#extensions#tabline#enabled = 1
set rtp+=~/.vim/bundle/typescript-tools.vim
" set t_Co=256

set guifont=Monaco\ 11
set wildmenu wildmode=full wildchar=<Tab>

set shiftwidth=2
set tabstop=2
set expandtab
set previewheight=8
set guicursor= 
" colorscheme vividchalk
if has('gui_running')
	set background=dark
	colorscheme solarized
	set guioptions -=m
	set guioptions -=T
else
  set termguicolors
"  set background=dark
"  colorscheme gruvbox
  colorscheme Tomorrow-Night
  "colorscheme nord
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

"let g:ctrlp_map = '<c-p>'
"let g:ctrlp_command = 'CtrlP'
"let g:ctrlp_switch_buffer='Et'
"let g:ctrlp_use_caching = 1
"let g:ctrlp_show_hidden = 1
"let g:ctrlp_clear_cache_on_exit = 0

"nnoremap <Leader>z :Eval<cr>

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
"au VimEnter *.clj RainbowParenthesesToggle
"au BufEnter *.pcc set syntax=c
"au BufEnter *.yml set filetype=ansible
"au BufEnter *.pc set syntax=c
"au Bufenter *vagrant* set syntax=ruby
"au Bufenter *Vagrant* set syntax=ruby
"au Syntax * RainbowParenthesesLoadRound
"au Syntax * RainbowParenthesesLoadSquare
"au Syntax * RainbowParenthesesLoadBraces
"au Syntax * RainbowParenthesesToggle

nnoremap <silent><F8> :NERDTreeToggle<CR>
nnoremap <silent><Leader>nt :NERDTreeToggle<CR>
nnoremap <silent><Leader>tb :TagbarToggle<CR>
nnoremap <silent><F9> :TagbarToggle<CR>

nnoremap <silent><C-Space> :call LanguageClient#textDocument_hover()<CR>
nnoremap <silent><leader>t :call LanguageClient_contextMenu()<CR>


let g:ackprg = 'ag --nogroup --nocolor --column'
let g:paredit_electric_return=0

set backspace=indent,eol,start
set smartindent
autocmd BufRead, BufNewFile *.cljs setlocal filetype=clojure
autocmd BufRead, BufNewFile Jenkinsfile set syntax=groovy
autocmd BufEnter, BufNewFile Jenkinsfile set syntax=groovy


let g:slime_target="tmux"
set noswapfile
set noerrorbells visualbell t_vb=
autocmd GUIEnter * set visualbell t_vb=

set laststatus=2
set ttimeoutlen=50

set relativenumber
" set cursorline
set t_ut=
set lazyredraw
set ttyfast


" javascript
"let g:used_javascript_libs = 'underscore,backbone,angularjs,angularuirouter,react,flux'

" syntastic
set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*

let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0

let g:syntastic_javascript_checkers = ['eslint']
let g:syntastic_typescript_checkers = ['eslint']

let g:languageClient_hoverPreview = 'Auto'
let g:go_highlight_functions = 1
let g:go_highlight_function_calls = 1
let g:go_highlight_fields = 1
let g:go_highlight_extra_types = 1
let g:go_highlight_types = 1

let g:airline#extensions#tabline#enabled = 0

let $FZF_DEFAULT_COMMAND = 'ag --hidden --ignore .git --ignore vendor -l -g ""'



" Customize fzf colors to match your color scheme
" let g:fzf_colors =
" \ { 'fg':      ['fg', 'Normal'],
"   \ 'bg':      ['bg', 'Normal'],
"   \ 'hl':      ['fg', 'Comment'],
"   \ 'fg+':     ['fg', 'CursorLine', 'CursorColumn', 'Normal'],
"   \ 'bg+':     ['bg', 'CursorLine', 'CursorColumn'],
"   \ 'hl+':     ['fg', 'Statement'],
"   \ 'info':    ['fg', 'PreProc'],
"   \ 'border':  ['fg', 'Ignore'],
"   \ 'prompt':  ['fg', 'Conditional'],
"   \ 'pointer': ['fg', 'Exception'],
"   \ 'marker':  ['fg', 'Keyword'],
"   \ 'spinner': ['fg', 'Label'],
"   \ 'header':  ['fg', 'Comment'] }


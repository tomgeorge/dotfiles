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
Plugin 'sainnhe/edge'
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

" JVM-based langs
" Plugin 'tpope/vim-classpath'
Plugin 'tpope/vim-fireplace'
Plugin 'guns/vim-sexp'
" Plugin 'tpope/vim-sexp-mappings-for-regular-people'

"Plugin 'chase/vim-ansible-yaml'
Plugin 'ekalinin/Dockerfile.vim'

Plugin 'fatih/vim-go'
call vundle#end()
call plug#begin('~/.vim/plugged')
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'liuchengxu/vista.vim'
Plug 'liuchengxu/vim-clap', { 'do': ':Clap install-binary' }
Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app & yarn install'  }
" Plug 'liquidz/vim-iced-coc-source', {'for': 'clojure'}
" Plug 'liquidz/vim-iced', {'for': 'clojure'}
call plug#end()
let g:go_def_mode='gopls'
let g:go_info_mode='gopls'

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
  set background=dark
  colorscheme edge
"  colorscheme gruvbox
"  colorscheme muon
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
"

nnoremap <silent><F8> :NERDTreeToggle<CR>
nnoremap <silent><Leader>nt :NERDTreeToggle<CR>
nnoremap <silent><Leader>tb :TagbarToggle<CR>
nnoremap <silent><F9> :TagbarToggle<CR>

let g:ackprg = 'ag --nogroup --nocolor --column'
let g:paredit_electric_return=0

set backspace=indent,eol,start
set smartindent
autocmd BufRead, BufNewFile *.cljs setlocal filetype=clojure
autocmd BufRead, BufNewFile Jenkinsfile set syntax=groovy
autocmd BufEnter, BufNewFile Jenkinsfile set syntax=groovy

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

let g:go_highlight_functions = 1
let g:go_highlight_function_calls = 1
let g:go_highlight_fields = 1
let g:go_highlight_extra_types = 1
let g:go_highlight_types = 1

let g:airline#extensions#tabline#enabled = 0

let $FZF_DEFAULT_COMMAND = 'ag --hidden --ignore .git --ignore vendor -l -g ""'

nnoremap <C-p> :Files<CR>
nnoremap <Leader>f :Rg<CR>
nnoremap <Leader>b :Buffers<CR>

" coc go configs
" if hidden is not set, TextEdit might fail.
set hidden
" Some servers have issues with backup files, see #649
set nobackup
set nowritebackup
" Better display for messages
set cmdheight=2
" You will have bad experience for diagnostic messages when it's default 4000.
set updatetime=300
" don't give |ins-completion-menu| messages.
set shortmess+=c
" always show signcolumns
set signcolumn=yes
" Use tab for trigger completion with characters ahead and navigate.
" Use command ':verbose imap <tab>' to make sure tab is not mapped by other plugin.
inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()
inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

" Use <c-space> to trigger completion.
inoremap <silent><expr> <c-space> coc#refresh()

" disable vim-go :GoDef short cut (gd)
" this is handled by LanguageClient [LC]
let g:go_def_mapping_enabled = 0
let g:go_doc_keywordprg_enabled = 0
" Use <cr> to confirm completion, `<C-g>u` means break undo chain at current position.
" Coc only does snippet and additional edit on confirm.
inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
" Or use `complete_info` if your vim support it, like:
" inoremap <expr> <cr> complete_info()["selected"] != "-1" ? "\<C-y>" : "\<C-g>u\<CR>"

" Remap keys for gotos
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)

" Use K to show documentation in preview window
nnoremap <silent> K :call <SID>show_documentation()<CR>

nnoremap <silent> <leader>re <Plug>(coc-refactor)<CR>

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction

" Highlight symbol under cursor on CursorHold
autocmd CursorHold * silent call CocActionAsync('highlight')

" Remap for rename current word
nmap <Leader>rn <Plug>(coc-rename)



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


let g:iced_enable_default_key_mappings = v:true

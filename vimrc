" set nocompatible
" filetype off
" let g:ale_disable_lsp = 1
" let mapleader = ","
" let maplocalleader = " "

"" =================
"" Colorschemes {{{
"" =================
"" Plug 'flazz/vim-colorschemes'
"Plug 'gregsexton/Muon'
"Plug 'jacoborus/tender.vim'
"Plug 'arcticicestudio/nord-vim'
"Plug 'sainnhe/edge'
"Plug 't184256/vim-boring'
"Plug 'rakr/vim-one'
"" }}}

"" Skinning 
"Plug 'vim-airline/vim-airline'
"Plug 'vim-airline/vim-airline-themes'
"Plug 'edkolev/tmuxline.vim'
"Plug 'kien/rainbow_parentheses.vim'

"" Git stuff
"Plug 'tpope/vim-fugitive'
"Plug 'airblade/vim-gitgutter'
"Plug 'gregsexton/gitv'

"" Utilities
""Plug 'tpope/vim-repeat'
"Plug 'tpope/vim-surround'
"Plug 'majutsushi/tagbar'
"Plug 'christoomey/vim-tmux-navigator'
"Plug 'scrooloose/nerdTree'
"Plug 'junegunn/fzf.vim'
"Plug 'tpope/vim-commentary'
"Plug 'tpope/vim-unimpaired'
"Plug 'tweekmonster/startuptime.vim'

"" ECMAScript-y langs
"" Plug 'leafgarland/typescript-vim'
""Plug 'pangloss/vim-javascript'
""" Plug 'othree/javascript-libraries-syntax.vim'
""Plug 'posva/vim-vue'

""" JVM-based langs
""" Plug 'tpope/vim-classpath'
""Plug 'tpope/vim-fireplace'
""Plug 'guns/vim-sexp'
""Plug 'guns/vim-clojure-highlight'
""Plug 'guns/vim-clojure-static'
""Plug 'tpope/vim-sexp-mappings-for-regular-people'

"""Plug 'chase/vim-ansible-yaml'
""Plug 'ekalinin/Dockerfile.vim'

""Plug 'fatih/vim-go'
""Plug 'neoclide/coc.nvim', {'branch': 'release'}
""Plug 'neovim/nvim-lspconfig'
""Plug 'nvim-lua/completion-nvim'
""" Plug 'Shougo/echodoc.vim'
""Plug 'liuchengxu/vista.vim'
""Plug 'liuchengxu/vim-clap', { 'do': ':Clap install-binary!' }
""" Plug 'Olical/conjure', { 'tag': '' }
""Plug '/home/tgeorge/git/conjure' 
""" Plug 'dense-analysis/ale'
""" Plug 'neomake/neomake'
""Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}  " We recommend updating the parsers on update
""Plug 'norcalli/snippets.nvim'
""Plug 'eraserhd/parinfer-rust', {'do':
""        \  'cargo build --release'}
""Plug 'kassio/neoterm'
"call plug#end()

" :lua << EOF
" local nvim_lsp = require('lspconfig')

" local custom_on_attach = function(client, bufnr)
"   local function buf_set_keymap(...) vim.api.nvim_buf_set_keymap(bufnr, ...) end
"   local function buf_set_option(...) vim.api.nvim_buf_set_option(bufnr, ...) end

"   require'completion'.on_attach(client)
"   buf_set_option('omnifunc', 'v:lua.vim.lsp.omnifunc')

"   local opts = { noremap=true, silent=false }
"   buf_set_keymap('n', '<c-]>', '<Cmd>lua vim.lsp.buf.definition()<CR>', opts)
"   buf_set_keymap('n', 'K', '<Cmd>lua vim.lsp.buf.hover()<CR>', opts)
" end

" nvim_lsp.sumneko_lua.setup{
"   cmd = {"/home/tgeorge/git/lua-language-server/bin/Linux/lua-language-server", "-E", "/home/tgeorge/git/lua-language-server/main.lua"};
"   on_attach = custom_on_attach,
"   settings = {
"     Lua = {
"       runtime = {
"         version = 'LuaJIT',
"         path = vim.split(package.path, ';'),
"       },
"       diagnostics = {
"         globals = { 'vim' },
"       },
"       workspace = {
"         library = {
"           [vim.fn.expand('$VIMRUNTIME/lua')] = true,
"           [vim.fn.expand('$VIMRUNTIME/lua/vim/lsp')] = true,
"         },
"       },
"     },
"   },
" }

" EOF

" nnoremap <silent> gd <cmd>lua vim.lsp.buf.definition()<CR>
" nnoremap <silent> KK <cmd>lua vim.lsp.buf.hover()<CR>



"let g:go_def_mode='gopls'
"let g:go_info_mode='gopls'

"syntax on
"filetype plugin indent on

"let g:airline#extensions#bufferline#enabled = 1
"let g:airline#extensions#tabline#enabled = 1
"" set t_Co=256
""
"set guifont=Monaco\ 11
"set wildmenu wildmode=full wildchar=<Tab>

"set shiftwidth=2
"set tabstop=2
"set expandtab
"set previewheight=8
"set guicursor= 
"" colorscheme vividchalk
"if has('gui_running')
"	set background=dark
"	colorscheme solarized
"	set guioptions -=m
"	set guioptions -=T
"else
"  set termguicolors
"  set background=dark
""  colorscheme boring
" " colorscheme edge
" " colorscheme gruvbox
"  " colorscheme muon
"  " colorscheme nord
" colorscheme one
"endif
"se nu
"set ruler

"set incsearch
"set ignorecase
"set smartcase
"nnoremap ss <C-w>s
"nnoremap wv <C-w>v
"nnoremap <Right> <Esc>:bn<Return>
"nnoremap <Left> <Esc>:bp<Return>
"nnoremap <Tab> <C-w>w
"nnoremap H  ^
"nnoremap L $
"nnoremap <C-tab> 	:tabn<CR>

"nnoremap <Leader>z :Eval<cr>

"" call neomake#configure#automake('nrwi', 500)


"let g:rbpt_colorpairs = [
"    \ ['brown',       'RoyalBlue3'],
"    \ ['Darkblue',    'SeaGreen3'],
"    \ ['darkgray',    'DarkOrchid3'],
"    \ ['darkgreen',   'firebrick3'],
"    \ ['darkcyan',    'RoyalBlue3'],
"    \ ['darkred',     'SeaGreen3'],
"    \ ['darkmagenta', 'DarkOrchid3'],
"    \ ['brown',       'firebrick3'],
"    \ ['gray',        'RoyalBlue3'],
"    \ ['black',       'SeaGreen3'],
"    \ ['darkmagenta', 'DarkOrchid3'],
"    \ ['Darkblue',    'firebrick3'],
"    \ ['darkgreen',   'RoyalBlue3'],
"    \ ['darkcyan',    'SeaGreen3'],
"    \ ['darkred',     'DarkOrchid3'],
"    \ ['red',         'firebrick3'],
"    \ ]

"let g:rbpt_max = 16
"let g:rbpt_loadcmd_toggle = 0
"au VimEnter *.clj RainbowParenthesesToggle
""au BufEnter *.pcc set syntax=c
""au BufEnter *.yml set filetype=ansible
""au BufEnter *.pc set syntax=c
""au Bufenter *vagrant* set syntax=ruby
""au Bufenter *Vagrant* set syntax=ruby
"au Syntax * RainbowParenthesesLoadRound
"au Syntax * RainbowParenthesesLoadSquare
"au Syntax * RainbowParenthesesLoadBraces
""

"nnoremap <silent><F8> :NERDTreeToggle<CR>
"nnoremap <silent><Leader>nt :NERDTreeToggle<CR>
"nnoremap <silent><Leader>tb :TagbarToggle<CR>
"nnoremap <silent><F9> :TagbarToggle<CR>

"let g:ackprg = 'ag --nogroup --nocolor --column'
"let g:paredit_electric_return=0

"set backspace=indent,eol,start
"set smartindent
"" autocmd BufRead, BufNewFile *.cljs setlocal filetype=clojure
"autocmd BufRead, BufNewFile Jenkinsfile set syntax=groovy
"autocmd BufEnter, BufNewFile Jenkinsfile set syntax=groovy

"set noswapfile
"set noerrorbells visualbell t_vb=
"autocmd GUIEnter * set visualbell t_vb=

"set laststatus=2
"set ttimeoutlen=50

"set relativenumber
"" set cursorline
"set t_ut=
"set lazyredraw
"set ttyfast


"" javascript
""let g:used_javascript_libs = 'underscore,backbone,angularjs,angularuirouter,react,flux'

"" syntastic
"" set statusline+=%#warningmsg#
"" set statusline+=%{SyntasticStatuslineFlag()}
"" set statusline+=%*

"" let g:syntastic_always_populate_loc_list = 1
"" let g:syntastic_auto_loc_list = 1
"" let g:syntastic_check_on_open = 1
"" let g:syntastic_check_on_wq = 0

"" let g:syntastic_javascript_checkers = ['eslint']
"" let g:syntastic_typescript_checkers = ['eslint']

"let g:go_highlight_functions = 1
"let g:go_highlight_function_calls = 1
"let g:go_highlight_fields = 1
"let g:go_highlight_extra_types = 1
"let g:go_highlight_types = 1

"let g:airline#extensions#tabline#enabled = 0

"let $FZF_DEFAULT_COMMAND = 'ag --hidden --ignore .git --ignore vendor -l ""'
"command! -bang -nargs=? -complete=dir Ag call fzf#vim#ag(<q-args>, '--hidden', <bang>0)

"nnoremap <C-p> :Files<CR>
"nnoremap <Leader>f :Rg<CR>
"nnoremap <Leader>b :Buffers<CR>

"" coc go configs
"" if hidden is not set, TextEdit might fail.
"set hidden
"" Some servers have issues with backup files, see #649
"set nobackup
"set nowritebackup
"" Better display for messages
"set cmdheight=2
"" You will have bad experience for diagnostic messages when it's default 4000.
"set updatetime=300
"" don't give |ins-completion-menu| messages.
"set shortmess+=c
"" always show signcolumns
"set signcolumn=yes
"" Use tab for trigger completion with characters ahead and navigate.
"" Use command ':verbose imap <tab>' to make sure tab is not mapped by other plugin.
"" inoremap <silent><expr> <TAB>
""       \ pumvisible() ? "\<C-n>" :
""       \ <SID>check_back_space() ? "\<TAB>" :
""       \ coc#refresh()
"" inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

"function! s:check_back_space() abort
"  let col = col('.') - 1
"  return !col || getline('.')[col - 1]  =~# '\s'
"endfunction

"" Use <c-space> to trigger completion.
"" inoremap <silent><expr> <c-space> coc#refresh()

"" disable vim-go :GoDef short cut (gd)
"" this is handled by LanguageClient [LC]
"let g:go_def_mapping_enabled = 0
"let g:go_doc_keywordprg_enabled = 0
"" Use <cr> to confirm completion, `<C-g>u` means break undo chain at current position.
"" Coc only does snippet and additional edit on confirm.
"" inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
"" Or use `complete_info` if your vim support it, like:
"" inoremap <expr> <cr> complete_info()["selected"] != "-1" ? "\<C-y>" : "\<C-g>u\<CR>"

"" Remap keys for gotos
"" nmap <silent> gd <Plug>(coc-definition)
"" nmap <silent> gy <Plug>(coc-type-definition)
"" nmap <silent> gi <Plug>(coc-implementation)
"" nmap <silent> gr <Plug>(coc-references)

"" Use K to show documentation in preview window
"" nnoremap <silent> K :call <SID>show_documentation()<CR>

"" nnoremap <silent> <leader>re <Plug>(coc-refactor)<CR>

"" Clojure stuff
"" nnoremap <leader>cljs :IcedStartCljsRepl shadow-cljs
"" nmap <silent> <leader>cc  <Plug>(iced_connect)<CR>
"" nmap <silent> <leader>so <Plug>(iced_stdout_buffer_open)<CR>

"" function! s:show_documentation()
""   if (index(['vim','help'], &filetype) >= 0)
""     execute 'h '.expand('<cword>')
""   else
""     call CocAction('doHover')
""   endif
"" endfunction


"" Highlight symbol under cursor on CursorHold
"" autocmd CursorHold * silent call CocActionAsync('highlight')

"" Remap for rename current word
"" nmap <Leader>rn <Plug>(coc-rename)

"" Refresh clojure namespace
"nmap <Leader>R :ConjureEval (clojure.tools.namespace.repl/refresh)<CR>

"" Use <Tab> and <S-Tab> to navigate through popup menu
"inoremap <expr> <Tab>   pumvisible() ? "\<C-n>" : "\<Tab>"
"inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"
"nmap <leader>rn <cmd>lua vim.lsp.buf.rename()<CR>

"" Set completeopt to have a better completion experience
"set completeopt=menuone,noinsert,noselect

"" Avoid showing message extra message when using completion
"set shortmess+=c

"" Customize fzf colors to match your color scheme
"" let g:fzf_colors =
"" \ { 'fg':      ['fg', 'Normal'],
""   \ 'bg':      ['bg', 'Normal'],
""   \ 'hl':      ['fg', 'Comment'],
""   \ 'fg+':     ['fg', 'CursorLine', 'CursorColumn', 'Normal'],
""   \ 'bg+':     ['bg', 'CursorLine', 'CursorColumn'],
""   \ 'hl+':     ['fg', 'Statement'],
""   \ 'info':    ['fg', 'PreProc'],
""   \ 'border':  ['fg', 'Ignore'],
""   \ 'prompt':  ['fg', 'Conditional'],
""   \ 'pointer': ['fg', 'Exception'],
""   \ 'marker':  ['fg', 'Keyword'],
""   \ 'spinner': ['fg', 'Label'],
""   \ 'header':  ['fg', 'Comment'] }


"" let g:iced_enable_default_key_mappings = v:true
"" let g:iced#buffer#stdout#mods = 'vertical'

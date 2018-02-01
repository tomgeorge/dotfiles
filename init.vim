set runtimepath^=~/.vim runtimepath+=~/.vim/after
let &packpath = &runtimepath
source ~/.vimrc
Plugin 'snoe/clj-refactor.nvim'
" Plugin 'snoe/nvim-parinfer.js'
Plugin 'Shougo/deoplete.nvim'
Plugin 'clojure-vim/async-clj-omni'
Plugin 'clojure-vim/vim-cider'
Plugin 'radenling/vim-dispatch-neovim'
Plugin 'clojure-vim/vim-jack-in'
Plugin 'hashivim/vim-terraform'
Plugin 'juliosueiras/vim-terraform-completion'

call deoplete#enable()
let g:deoplete#keyword_patterns = {}
let g:deoplete#keyword_patterns.clojure = '[\w!$%&*+/:<=>?@\^_~\-\.#]*'
let g:deoplete#omni_patterns = {}
let g:deoplete#omni_patterns.terraform = '[^ *\t"{=$]\w*'
let g:deoplete#enable_at_startup = 1
call deoplete#initialize()

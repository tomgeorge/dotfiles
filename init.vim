set runtimepath^=~/.vim runtimepath+=~/.vim/after
let &packpath = &runtimepath
source ~/.vimrc
Plugin 'snoe/clj-refactor.nvim'
" Plugin 'snoe/nvim-parinfer.js'
Plugin 'Shougo/deoplete.nvim'
Plugin 'zchee/deoplete-go'
Plugin 'mdempsky/gocode', {'rtp': 'nvim/'}
Plugin 'clojure-vim/async-clj-omni'
Plugin 'clojure-vim/vim-cider'
Plugin 'radenling/vim-dispatch-neovim'
Plugin 'clojure-vim/vim-jack-in'
Plugin 'neomake/neomake'
Plugin 'hashivim/vim-terraform'
Plugin 'juliosueiras/vim-terraform-completion'

let g:deoplete#keyword_patterns = {}
let g:deoplete#keyword_patterns.clojure = '[\w!$%&*+/:<=>?@\^_~\-\.#]*'
let g:deoplete#omni_patterns = {}
let g:deoplete#omni_patterns.terraform = '[^ *\t"{=$]\w*'
let g:deoplete#enable_at_startup = 1

call deoplete#initialize()

" (Optional) Enable terraform plan to be include in filter
let g:syntastic_terraform_tffilter_plan = 1

" (Optional) Default: 0, enable(1)/disable(0) plugin's keymapping
let g:terraform_completion_keys = 1

" (Optional) Default: 1, enable(1)/disable(0) terraform module registry completion
let g:terraform_registry_module_completion = 0
tnoremap <Esc> <C-\><C-n>

" Error and warning signs.
let g:ale_sign_error = '⤫'
let g:ale_sign_warning = '⚠'
" Enable integration with airline.
let g:airline#extensions#ale#enabled = 1
set termguicolors


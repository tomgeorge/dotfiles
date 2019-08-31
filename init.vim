set runtimepath^=~/.vim runtimepath+=~/.vim/after
let &packpath = &runtimepath
source ~/.vimrc
"Plugin 'snoe/clj-refactor.nvim'
" Plugin 'snoe/nvim-parinfer.js'
" Plugin 'Shougo/deoplete.nvim'
"Plugin 'Shougo/defx.nvim'
Plugin 'Shougo/echodoc.vim'
"Plugin 'clojure-vim/async-clj-omni'
"Plugin 'clojure-vim/vim-cider'
"Plugin 'radenling/vim-dispatch-neovim'
"Plugin 'clojure-vim/vim-jack-in'
"Plugin 'neomake/neomake'
"Plugin 'hashivim/vim-terraform'
"Plugin 'juliosueiras/vim-terraform-completion'
Plugin 'maralla/completor.vim'


""let g:deoplete#keyword_patterns = {}
"let g:deoplete#sources#go = ['vim-go']
"let g:deoplete#sources#go#gocode_binary = '/dev/null'
""let g:deoplete#keyword_patterns.clojure = '[\w!$%&*+/:<=>?@\^_~\-\.#]*'
""let g:deoplete#omni_patterns = {}
""let g:deoplete#omni_patterns.terraform = '[^ *\t"{=$]\w*'
"let g:deoplete#enable_at_startup = 1

let g:completor_filetype_map = {}
" Enable lsp for go by using gopls
let g:completor_filetype_map.go = {'ft': 'lsp', 'cmd': 'gopls'}
let g:completor_complete_options = 'menuone,noselect,preview'

"call deoplete#initialize()

"call deoplete#custom#option('omni_patterns', {
" \ 'go': '[^. *\t]\.\w*',
" \})
" (Optional) Enable terraform plan to be include in filter
"let g:syntastic_terraform_tffilter_plan = 1

" (Optional) Default: 0, enable(1)/disable(0) plugin's keymapping
"let g:terraform_completion_keys = 1

" (Optional) Default: 1, enable(1)/disable(0) terraform module registry completion
"let g:terraform_registry_module_completion = 0
tnoremap <Esc> <C-\><C-n>

" Error and warning signs.
let g:ale_sign_error = '⤫'
let g:ale_sign_warning = '⚠'
" Enable integration with airline.
let g:airline#extensions#ale#enabled = 1
set termguicolors

" Launch gopls when Go files are in use
 let g:LanguageClient_serverCommands = {
       \ 'go': ['gopls'],
       \ 'yaml': ['yaml-language-server', '--stdio'],
       \ 'python': ['~/.local/bin/pyls']
       \ }
if &ft ==# 'yaml' || &ft ==# 'json'
  let settings = json_decode('
      \{
      \    "yaml": {
      \        "completion": false,
      \        "hover": true,
      \        "validate": true,
      \        "schemas": {
      \            "Kubernetes": "/*"
      \        },
      \        "format": {
      \            "enable": true
      \        }
      \    },
      \    "http": {
      \        "proxyStrictSSL": true
      \    }
      \}')
  aug LanguageClient_config
      au!
      au User LanguageClientStarted call LanguageClient#Notify(
          \ 'workspace/didChangeConfiguration', {'settings': settings})
  aug END
endif
" Run gofmt and goimports on save
"autocmd BufWritePre *.go :call LanguageClient#textDocument_formatting_sync()

" For echodoc
set cmdheight=2
"call deoplete#custom#source('_', 'max_abbr_width', 160)
let g:echodoc#enable_at_startup = 1
let g:LanguageClient_loggingFile = expand('~/.vim/LanguageClient.log')
let g:LanguageClient_serverStderr = expand('~/.vim/LanguageServer.log')

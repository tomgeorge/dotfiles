let localmapleader=' '
" nnoremap <Leader>R :ConjureEval (clojure.tools.namespace.repl/refresh)<CR>
" inoremap <C-Space> <C-x><C-o>
" inoremap <C-@> <C-Space>
" inoremap <expr> <CR> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
" " let g:conjure#debug=v:true
"
" function! Expand(exp) abort
"     let l:result = expand(a:exp)
"     return l:result ==# '' ? '' : "file://" . l:result
" endfunction

" nnoremap <silent> crth <Cmd>lua vim.lsp.buf.execute_command({command='thread-first', arguments = { Expand('%:p'), line('.') - 1, col('.') - 1 }})<CR>
" :lua vim.lsp.buf.execute_command({command = 'introduce-let', arguments = {'file:///home/tgeorge/git/diabetes-dashboard-server/dev/user.clj', 37, 0, 'odds'}})


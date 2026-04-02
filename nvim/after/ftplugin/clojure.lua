vim.g["conjure#log#hud#anchor"] = "NE"
vim.g["conjure#log#hud#border"] = "none"

vim.g["conjure#mapping#doc_word"] = "K"
vim.g["conjure#client#clojure#nrepl#connection#auto_repl#enabled"] = false
vim.g["conjure#client#clojure#nrepl#eval#raw_out"] = true
vim.g["conjure#client#clojure#nrepl#refresh#backend"] = "clj-reload"
-- local function on_attach(buf)
--   print("firing conjure on_attach")
--   ---@type vim.api.keyset.get_keymap[]
--   for _, map in ipairs(vim.api.nvim_buf_get_keymap(buf, "n")) do
--     if map.lhs == "C-]" then
--       print("deleting lsp definition")
--       vim.keymap.del("n", "C-]", { buffer = buf })
--     end
--   end
--   print("setting conjure deifnition")
--   vim.keymap.set("n", "C-]", "<Cmd>ConjureDefWord<CR>", { desc = "Conjure goto definition", buffer = buf })
-- end
--
-- vim.api.nvim_create_autocmd("LspAttach", {
--   group = vim.api.nvim_create_augroup("clojure.lsp", {}),
--   callback = function(args)
--     on_attach(args.buf)
--   end,
--   desc = "Rebind Conjure Keymaps",
-- })
--

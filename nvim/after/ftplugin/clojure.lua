vim.g.maplocalleader = ","
vim.g["conjure#log#hud#anchor"] = "NE"
vim.g["conjure#log#hud#border"] = "none"
vim.g["conjure#mapping#doc_word"] = nil
vim.g["conjure#client#clojure#nrepl#connection#auto_repl#enabled"] = false
vim.g["conjure#client#clojure#nrepl#eval#raw_out"] = true

vim.keymap.set("n", "C-]", "<Cmd>ConjureDefWord<CR>", { desc = "Conjure" })

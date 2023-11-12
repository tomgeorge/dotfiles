vim.g.maplocalleader = ","
vim.g["conjure#log#hud#anchor"] = "SE"
vim.g["conjure#log#hud#border"] = "none"
vim.g["conjure#mapping#doc_word"] = nil

vim.keymap.set("n", "C-]", "<Cmd>ConjureDefWord<CR>", { desc = "Conjure" })

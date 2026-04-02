local M = {}
local lsp_ns = vim.api.nvim_create_namespace("my.lsp")
local diagnostic_ns = vim.api.nvim_create_namespace("on_diagnostic_jump")
local function on_attach(_, bufnr)
  local function keymap(mode, lhs, rhs, desc)
    vim.keymap.set(mode, lhs, rhs, { buffer = bufnr, desc = desc })
  end

  vim.lsp.document_color.enable(true, bufnr)
  keymap("n", "<leader>rn", vim.lsp.buf.rename, "LSP Rename")
  keymap("n", "<leader>ca", function()
    require("commands").code_action()
  end, "LSP Code Action")
  keymap("n", "C-]", function()
    require("commands").lsp_definition()
  end, "LSP Definition")
  keymap("n", "<leader>rr", function()
    require("commands").lsp_references()
  end, "LSP References")
  keymap("n", "<leader>ri", function()
    require("commands").lsp_implementations()
  end, "LSP Implementations")
  keymap("n", "<leader>ld", function()
    require("commands").lsp_document_symbols()
  end, "LSP Document Symbols")

  vim.diagnostic.config({
    signs = {
      text = {
        [vim.diagnostic.severity.ERROR] = "󰅙",
        [vim.diagnostic.severity.INFO] = "󰋼",
        [vim.diagnostic.severity.HINT] = "󰌵",
        [vim.diagnostic.severity.WARN] = "",
      },
    },
    float = { border = "single" },
    -- virtual_text = false,
    virtual_text = {
      spacing = 4,
      prefix = "",
      current_line = true,
    },
    underline = true,
    severity_sort = true,
  })
end

vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("my.lsp", {}),
  callback = function(args)
    local bufnr = args.buf
    local client = assert(vim.lsp.get_client_by_id(args.data.client_id))

    if client:supports_method(vim.lsp.protocol.Methods.textDocument_inlineCompletion, bufnr) then
      -- vim.lsp.inline_completion.enable(true, { bufnr = bufnr })

      vim.keymap.set(
        "i",
        "<C-F>",
        vim.lsp.inline_completion.get,
        { desc = "LSP: accept inline completion", buffer = bufnr }
      )
      vim.keymap.set(
        "i",
        "<C-G>",
        vim.lsp.inline_completion.select,
        { desc = "LSP: switch inline completion", buffer = bufnr }
      )

      vim.keymap.set("n", "<leader>ic", function()
        vim.lsp.inline_completion.enable(vim.lsp.inline_completion.is_enabled())
      end, { desc = "LSP: Toggle inline completion", buffer = bufnr })
    end

    if client and client.server_capabilities and client.name == "terraform-ls" then
      client.server_capabilities.semanticTokensProvider = nil
    end
    on_attach(client, args.buf)
  end,
  desc = "Configure LSP keymaps",
})

vim.api.nvim_create_autocmd({ "BufReadPre", "BufNewFile" }, {
  once = true,
  desc = "Enable LSP",
  callback = function()
    local server_configs = vim
      .iter(vim.api.nvim_get_runtime_file("lsp/*.lua", true))
      :map(function(file)
        return vim.fn.fnamemodify(file, ":t:r")
      end)
      -- FIXME: copilot isn't working, NES is buggy and annoying
      :filter(function(server)
        return server ~= "copilot"
      end)
      :totable()
    vim.lsp.enable(server_configs)
  end,
})

return M

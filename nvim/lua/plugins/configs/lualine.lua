local M = {}

M.status_line = function()
  return require("lsp-progress").progress({
    format = function(messages)
      local active_clients = vim.lsp.get_clients()
      local client_count = #active_clients
      if #messages > 0 then
        return " LSP:" .. client_count .. " " .. table.concat(messages, " ")
      end
      if #active_clients <= 0 then
        return " LSP:" .. client_count
      else
        local client_names = {}
        for i, client in ipairs(active_clients) do
          if client and client.name ~= "" then
            table.insert(client_names, client.name)
          end
        end
        return " LSP:" .. client_count .. " [" .. table.concat(client_names, " ") .. "]"
      end
    end,
  })
end
return M

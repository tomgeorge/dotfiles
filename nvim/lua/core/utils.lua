local M = {}

M.load_mappings = function(section, mapping_opt)
  vim.schedule(function()
    local function set_section_map(section_values)
      if section_values.plugin then
        return
      end

      section_values.plugin = nil

      for mode, mode_values in pairs(section_values) do
        local default_opts = vim.tbl_deep_extend("force", { mode = mode }, mapping_opt or {})
        for keybind, mapping_info in pairs(mode_values) do
          local opts = vim.tbl_deep_extend("force", default_opts, mapping_info.opts or {})
          -- if keybind == "%%" then
          --   vim.notify("mapping_info is " .. vim.inspect(mapping_info))
          -- end
          mapping_info.opts, opts.mode = nil, nil
          opts.desc = mapping_info[2]

          -- if keybind == "%%" then
          --   vim.notify("keybind" .. vim.inspect(keybind))
          --   vim.notify("mode" .. vim.inspect(mode))
          --   vim.notify("opts" .. vim.inspect(opts))
          -- end
          vim.keymap.set(mode, keybind, mapping_info[1], opts)
        end
      end
    end

    local mappings = require("core.mappings")

    if type(section) == "string" then
      mappings[section]["plugin"] = nil
      mappings = { mappings[section] }
    end

    for _, sect in pairs(mappings) do
      set_section_map(sect)
    end
  end)
end

M.lazy_load = function(plugin)
  vim.api.nvim_create_autocmd({ "BufRead", "BufWinEnter", "BufNewFile" }, {
    group = vim.api.nvim_create_augroup("BeLazyOnFileOpen" .. plugin, {}),
    callback = function()
      local file = vim.fn.expand("%")
      local condition = file ~= "NvimTree_1" and file ~= "[lazy]" and file ~= ""

      if condition then
        vim.api.nvim_del_augroup_by_name("BeLazyOnFileOpen" .. plugin)

        -- dont defer for treesitter as it will show slow highlighting
        -- This deferring only happens only when we do "nvim filename"
        if plugin ~= "nvim-treesitter" then
          vim.schedule(function()
            require("lazy").load({ plugins = plugin })

            if plugin == "nvim-lspconfig" then
              vim.cmd("silent! do FileType")
            end
          end)
        else
          require("lazy").load({ plugins = plugin })
        end
      end
    end,
  })
end

return M

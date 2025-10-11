local commands = {}

local function has(lib)
  local ok, _ = pcall(require, lib)
  return ok
end

function commands.lsp_references()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_references()
  end
  return vim.lsp.buf.references()
end

function commands.lsp_implementations()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_implementations()
  end
  return vim.lsp.buf.implementation()
end

function commands.lsp_document_symbols()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_symbols()
  end
  return vim.lsp.buf.document_symbol()
end

function commands.code_action()
  if has("tiny-code-action") then
    ---@diagnostic disable-next-line: missing-parameter
    return require("tiny-code-action").code_action()
  end
  return vim.lsp.buf.code_action()
end

function commands.lsp_definition()
  if has("snacks.picker") then
    return Snacks.picker.lsp_definitions()
  end
  return vim.lsp.buf.definition()
end

function commands.toggle_stevearc_profile()
  local has_profile, profile = pcall(require, "profile")
  if not has_profile then
    vim.notify("profile.nvim not loaded")
  end
  if profile.is_recording() then
    profile.stop()
    vim.ui.input({ prompt = "Save profile to:", completion = "file", default = "profile.json" }, function(filename)
      if filename then
        profile.export(filename)
        vim.notify(string.format("Wrote %s", filename))
      end
    end)
  else
    profile.start("*")
  end
end

function commands.compare_with()
  local has_snacks, snacks = pcall(require, "snacks")
  if not has_snacks then
    vim.notify("No snacks")
    return
  end

  local has_diffview, _ = pcall(require, "diffview")
  if not has_diffview then
    vim.notify("No diffview")
    return
  end

  snacks.picker.git_branches({
    title = "Compare with...",
    confirm = function(picker, item)
      picker:close()
      if item then
        vim.schedule(function()
          vim.cmd(string.format("DiffviewOpen %s", item.branch))
        end)
      end
    end,
  })
end

function commands.conditional_breakpoint()
  local ok, dap = pcall(require, "dap")
  if ok then
    vim.ui.input({
      prompt = "Set conditional breakpoint",
    }, function(choice)
      dap.toggle_breakpoint(choice)
    end)
  end
end

function commands.unload_lua_ns()
  local has_snacks, snacks = pcall(require, "snacks")
  if not has_snacks then
    vim.notify("No snacks")
    return
  end
  snacks.picker(
    ---@type snacks.picker.Config
    {
      source = "packages (be careful!)",
      finder = function(_, _)
        ---@type snacks.picker.finder.Item[]
        local items = {}
        for _, pkg in pairs(vim.tbl_keys(package.loaded)) do
          table.insert(items, { text = pkg })
        end
        return items
      end,
      format = "text",
      layout = {
        hidden = { "preview" },
      },
      confirm = function(picker, item, action)
        if #picker:selected() == 0 then
          package.loaded[item.text] = nil
          vim.notify("unloaded " .. item.text)
          picker:close()
        end

        local count = #picker:selected()
        for i, pkg in pairs(picker:selected()) do
          package.loaded[pkg.text] = nil
          if i == count then
            vim.notify("unloaded " .. #picker:selected() .. " packages")
          end
        end
        picker:close()
      end,
    }
  )
end

return commands

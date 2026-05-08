local commands = {}

local function has(lib)
  local ok, _ = pcall(require, lib)
  return ok
end

function commands.lsp_references()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_references()
  end
  if has("mini.extra") then
    return MiniExtra.pickers.lsp({ scope = "references" })
  end
  return vim.lsp.buf.references()
end

function commands.lsp_implementations()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_implementations()
  end
  if has("mini.extra") then
    return MiniExtra.pickers.lsp({ scope = "implementation" })
  end
  return vim.lsp.buf.implementation()
end

function commands.lsp_document_symbols()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_symbols()
  end
  if has("mini.extra") then
    return MiniExtra.pickers.lsp({ scope = "document_symbol" })
  end
  return vim.lsp.buf.document_symbol()
end

function commands.lsp_definition()
  if has("snacks.picker") then
    return Snacks.picker.lsp_definitions()
  end
  if has("mini.extra") then
    return MiniExtra.pickers.lsp({ scope = "definition" })
  end
  return vim.lsp.buf.definition()
end

function commands.lsp_type_definitions()
  if has("snacks.picker") then
    return require("snacks").picker.lsp_type_definitions()
  end
  if has("mini.extra") then
    return MiniExtra.pickers.lsp({ scope = "type_definition" })
  end
  return vim.lsp.buf.type_definition()
end

function commands.lsp_workspace_symbols()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_workspace_symbols()
  end
  if has("mini.extra") then
    return MiniExtra.pickers.lsp({ scope = "workspace_symbol" })
  end
  return vim.lsp.buf.workspace_symbol()
end

function commands.lsp_incoming_calls()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_incoming_calls()
  end
  return vim.lsp.buf.incoming_calls()
end

function commands.lsp_outgoing_calls()
  if has("snacks.picker") then
    return require("snacks.picker").lsp_outgoing_calls()
  end
  return vim.lsp.buf.outgoing_calls()
end

function commands.code_action()
  if has("tiny-code-action") then
    ---@diagnostic disable-next-line: missing-parameter
    return require("tiny-code-action").code_action()
  end
  return vim.lsp.buf.code_action()
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
  local has_diffview, _ = pcall(require, "diffview")
  if not has_diffview then
    vim.notify("No diffview")
    return
  end

  local has_snacks, snacks = pcall(require, "snacks")
  if has_snacks then
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
    return
  end

  if has("mini.pick") then
    local branches = vim.fn.systemlist("git branch --all --format='%(refname:short)'")
    MiniPick.start({
      source = {
        name = "Compare with...",
        items = branches,
        choose = function(item)
          vim.schedule(function()
            vim.cmd(string.format("DiffviewOpen %s", item))
          end)
        end,
      },
    })
    return
  end

  vim.notify("No picker available")
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
  if has_snacks then
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
    return
  end

  if has("mini.pick") then
    local items = vim.tbl_keys(package.loaded)
    table.sort(items)
    MiniPick.start({
      source = {
        name = "packages (be careful!)",
        items = items,
        choose = function(item)
          package.loaded[item] = nil
          vim.notify("unloaded " .. item)
        end,
      },
    })
    return
  end

  vim.notify("No picker available")
end

function commands.notifications()
  if has("snacks") then
    if has("snacks.picker") then
      return Snacks.picker.notifications({ confirm = { "yank", "focus_preview" } })
    end
    if has("mini.pick") then
      local history = Snacks.notifier.get_history()
      local items = {}
      for i = #history, 1, -1 do
        local n = history[i]
        local level = vim.log.levels[n.level] or n.level or ""
        table.insert(items, {
          text = string.format("[%s] %s", level, n.msg),
          msg = n.msg,
        })
      end
      MiniPick.start({
        source = {
          name = "Notifications",
          items = items,
          choose = function(item)
            vim.fn.setreg("+", item.msg)
            vim.notify("Yanked to clipboard")
          end,
        },
      })
      return
    end
  end
  vim.notify("No notification backend available")
end

return commands

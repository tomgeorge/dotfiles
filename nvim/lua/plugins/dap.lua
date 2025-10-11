return {
  "rcarriga/nvim-dap-ui",
  dependencies = {
    {
      "mfussenegger/nvim-dap",
      keys = {
        {
          "<leader>ddc",
          function()
            require("commands").conditional_breakpoint()
          end,
          desc = "Set conditional breakpoint",
        },
        {
          "<leader>dc",
          function()
            require("dap").continue()
          end,
          desc = "Start Debugger/Continue",
        },
        {
          "<F5>",
          function()
            require("dap").continue()
          end,
          desc = "Start Debugger/Continue",
        },
        {
          "<leader>db",
          function()
            require("dap").toggle_breakpoint()
          end,
          desc = "Toggle breakpoint",
        },
        {
          "<F9>",
          function()
            require("dap").toggle_breakpoint()
          end,
          desc = "Toggle breakpoint",
        },
        {
          "<leader>dn",
          function()
            require("dap").step_over()
          end,
          desc = "Step Over",
        },
        {
          "<F10>",
          function()
            require("dap").step_over()
          end,
          desc = "Step Over",
        },
        {
          "<leader>ds",
          function()
            require("dap").step_into()
          end,
          desc = "Step Into",
        },
        {
          "<F11>",
          function()
            require("dap").step_into()
          end,
          desc = "Step Into",
        },
        {
          "<leader>dl",
          function()
            require("osv").launch({ port = 8086 })
          end,
        },
        {
          "<leader>do",
          function()
            require("dap").step_out()
          end,
          desc = "Step Out",
        },
        {
          "<F23>",
          function()
            require("dap").step_out()
          end,
          desc = "Step Out",
        },
        {
          "<leader>dX",
          function()
            require("dap").terminate()
          end,
          desc = "Terminate debug session",
        },
        {
          "<F17>",
          function()
            require("dap").terminate()
          end,
          desc = "Terminate debug session",
        },
        {
          "<leader>dt",
          function()
            require("dap-go").debug_test()
          end,
          desc = "Debug test",
        },
        {
          "<leader>dh",
          function()
            require("dap.ui.widgets").hover()
          end,
          desc = "Hover",
        },
        {
          "<leader>dx",
          function()
            require("dapui").close()
            if require("osv").is_running() then
              require("osv").stop()
              print("stopped osv")
            end
          end,
          desc = "Close",
        },
      },
    },
    {
      "leoluz/nvim-dap-go",
      config = function()
        require("dap-go").setup({

          dap_configurations = {
            {
              type = "go",
              name = "Attach remote (port 43000)",
              mode = "remote",
              request = "attach",
              connect = {
                host = "127.0.0.1",
                port = "43000",
              },
            },
          },
          delve = {
            port = "43000",
          },
        })
      end,
    },
    {
      "theHamsta/nvim-dap-virtual-text",
      config = true,
    },
    { "nvim-neotest/nvim-nio" },
    {
      "jbyuki/one-small-step-for-vimkind",
      config = function(opts)
        require("dap").configurations.lua = {
          {
            type = "nlua",
            request = "attach",
            name = "Attach to running Neovim instance",
          },
        }

        require("dap").adapters.nlua = function(callback, config)
          callback({ type = "server", host = config.host or "127.0.0.1", port = config.port or 8086 })
        end
      end,
      keys = {
        {
          "<leader>dl",
          function()
            require("osv").launch({ port = 8086 })
          end,
        },
      },
    },
  },
  config = function()
    require("dapui").setup()
    local dap, dapui = require("dap"), require("dapui")
    dap.listeners.after.event_initialized["dapui_config"] = function()
      dapui.open()
    end
  end,
}

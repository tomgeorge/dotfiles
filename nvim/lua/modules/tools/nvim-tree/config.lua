local nvim_tree = {}

function nvim_tree.setup()
  require('nvim-tree').setup({
    diagnostics = {
      enable = true,
      show_on_dirs = true,
      debounce_delay = 50,
      icons = {
        hint = '',
        info = '',
        warning = '',
        error = '',
      },
    },
  })
end

return nvim_tree

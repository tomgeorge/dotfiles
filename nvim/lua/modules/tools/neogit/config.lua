local M = {}

M.setup = function()
  require('neogit').setup({
    integrations ={
      diffview = true
    }
  })
end

return M

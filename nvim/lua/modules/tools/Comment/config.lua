M = {}

local comment = require('comment')

M.setup = function()
  comment.setup({
    pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook(),
  })
end

return M

local Fugitive = {}
local current_buffer_history = function()
  vim.cmd('Git log --oneline ' .. vim.api.nvim_buf_get_name(0))
end

Fugitive.current_buffer_history = current_buffer_history
return Fugitive

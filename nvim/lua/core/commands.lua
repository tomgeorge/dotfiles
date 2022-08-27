local current_buffer_history = function()
  print('path ' .. vim.api.nvim_buf_get_name(0))
  local format_string ='%h - %s <%an> (%ar)'
  vim.cmd("Git log --pretty='" .. format_string .. "' " .. vim.api.nvim_buf_get_name(0))
end
vim.api.nvim_create_user_command('CurrentBufGitHistory', current_buffer_history, {desc = 'Open the output of git log -p <current file>'})

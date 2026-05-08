---@module 'lazy'

---@type LazySpec[]
return {
  {
    "rachartier/tiny-code-action.nvim",
    -- dev = true,
    -- dir = "~/git/tiny-code-action.nvim/",
    dependencies = {},
    event = "LspAttach",
    opts = { backend = "vim", picker = "buffer" },
  },
}

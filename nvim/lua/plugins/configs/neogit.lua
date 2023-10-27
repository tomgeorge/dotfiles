local M = {}

M.opts = {
  mappings = {
    status = {
      ["]c"] = "GoToNextHunkHeader",
      ["[c"] = "GoToPreviousHunkHeader",
    },
  },
  commit_editor = {
    kind = "vsplit",
  },
}

return M

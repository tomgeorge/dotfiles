local M = {}

M.opts = {
  mappings = {
    status = {
      ["]c"] = "GoToNextHunkHeader",
      ["[c"] = "GoToPreviousHunkHeader",
    },
  },
}

return M

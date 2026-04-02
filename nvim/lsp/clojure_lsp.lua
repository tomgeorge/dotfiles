---@type vim.lsp.Config
return {
  cmd = { "clojure-lsp", "--verbose" },
  filetypes = { "clojure", "edn" },
  root_markers = { "project.clj", "deps.edn", "build.boot", "shadow-cljs.edn", ".git", "bb.edn" },
  init_options = {
    java_download_jdk_source = true,
  },
}

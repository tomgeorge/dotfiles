{
  flake.modules = {
    homeManager.editing =
      { pkgs, ... }:
      {
        home.packages = with pkgs; [
          bash-language-server
          clj-kondo
          clojure-lsp
          fish-lsp
          golangci-lint
          htmx-lsp2
          lua-language-server
          luajitPackages.luacheck
          nixd
          nixfmt
          shellcheck
          shfmt
          tailwindcss-language-server
          tree-sitter
          typescript-language-server
        ];
      };
  };
}

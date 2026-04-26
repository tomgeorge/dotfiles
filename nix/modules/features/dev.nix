{ config, lib, ... }:

let
  inherit (config.my) gitName gitEmail;
in
{
  flake.modules = {
    homeManager.dev =
      { pkgs, ... }:
      {
        home.sessionVariables = {
          "EDITOR" = "nvim";
        };

        programs.git = {
          enable = true;
          settings = {
            user.name = gitName;
            user.email = gitEmail;
            init.defaultBranch = "main";
          };
          signing.format = "openpgp";
        };

        programs.gpg = {
          enable = true;
        };

        programs.mise = {
          enable = true;
          enableFishIntegration = true;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };

        programs.claude-code = lib.mkIf pkgs.stdenv.isDarwin {
          enable = true;
        };

        home.packages = with pkgs; [
          babashka
          balena-cli
          bat
          bitwarden-cli
          claude-code
          clj-kondo
          clojure-lsp
          cmake
          coreutils
          cosign
          curl
          dive
          erlang
          fd
          flyctl
          gettext
          github-cli
          gnupg
          gnutls
          golangci-lint
          htmx-lsp2
          htop
          k9s
          lazygit
          lua-language-server
          luajitPackages.luacheck
          neil
          neovim
          ninja
          nixd
          nixfmt
          pass
          ripgrep
          shellcheck
          skopeo
          sqlc
          stow
          tailwindcss-language-server
          templ
          terraform-ls
          tmux
          tree-sitter
          typescript-language-server
          yazi
        ];
      };
  };
}

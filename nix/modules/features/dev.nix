{ lib, ... }:

{
  flake.modules = {
    homeManager.dev =
      { config, pkgs, ... }:
      let
        inherit (config.user) userFullName userEmail;
      in
      {
        home.sessionVariables = {
          "EDITOR" = "nvim";
        };

        programs.git = {
          enable = true;
          settings = {
            user.name = userFullName;
            user.email = userEmail;
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
          apko
          babashka
          balena-cli
          bash-language-server
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
          fish-lsp
          flyctl
          gettext
          github-cli
          gnupg
          gnutls
          golangci-lint
          htmx-lsp2
          htop
          k9s
          kind
          kubectl
          kubectx
          lazygit
          lua-language-server
          luajitPackages.luacheck
          melange
          neil
          neovim
          ninja
          nixd
          nixfmt
          pass
          podman-tui
          podman
          podman-desktop
          ripgrep
          shellcheck
          shfmt
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

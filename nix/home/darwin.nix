{ config, pkgs, ... }:

{
  home = {
    username = "tgeorge";
    homeDirectory = "/Users/tgeorge";
  };

  programs.fish.shellAliases = {
    rebuild = "sudo darwin-rebuild switch --flake $HOME/git/dotfiles/nix";
  };

  programs.claude-code = {
    enable = true;
  };

  programs.wezterm = {
    enable = true;
    enableBashIntegration = true;
    enableZshIntegration = true;
  };

  home.packages = with pkgs; [
    babashka
    balena-cli
    bitwarden-cli
    claude-code
    clj-kondo
    clojure-lsp
    cosign
    dive
    gnutls
    golangci-lint
    htmx-lsp2
    k9s
    lua-language-server
    neil
    pass
    skopeo
    sqlc
    stow
    tailwindcss-language-server
    templ
    terraform-ls
    typescript-language-server
  ];
}

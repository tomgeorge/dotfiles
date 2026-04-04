{ config, pkgs, ... }:

{
  home = {
    username = "tgeorge";
    homeDirectory = "/Users/tgeorge";
    stateVersion = "24.11";
    shell = {
      enableFishIntegration = true;
    };
  };

  programs.home-manager.enable = true;

  programs.fish = {
    enable = true;
    shellAliases = {
      vi = "nvim";
      vim = "nvim";
      diff = "nvim -d";
      rebuild = "sudo darwin-rebuild switch --flake ~/.config/nix";
      cd = "z";
      hmh = "man home-configuration.nix";
    };
    interactiveShellInit = ''
      set -g fish_key_bindings fish_vi_key_bindings
    '';

    plugins = [
      # TODO modify keybindings
      {
        name = "fzf.fish";
        src = pkgs.fetchFromGitHub {
          owner = "PatrickF1";
          repo = "fzf.fish";
          rev = "0069dbbe06cc05482bfb13063b4b4eac26318992";
          hash = "sha256-H7HgYT+okuVXo2SinrSs+hxAKCn4Q4su7oMbebKd/7s=";
        };
      }
    ];
  };

  programs.zoxide = {
    enable = true;
    enableFishIntegration = true;
    enableBashIntegration = true;
    enableZshIntegration = true;
  };

  programs.starship = {
    enable = true;
    presets = [
      "nerd-font-symbols"
      # "catppuccin-powerline"
    ];
  };

  # TODO gitconfig
  programs.git = {
    enable = true;
    settings = {
      user.name = "Tom George";
      user.email = "tg8490@gmail.com";
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

  programs.fzf = {
    enable = true;
    enableFishIntegration = true;
    enableZshIntegration = true;
    enableBashIntegration = true;
  };

  programs.claude-code = {
    enable = true;
  };

  programs.wezterm = {
    enable = true;
    enableBashIntegration = true;
    enableZshIntegration = true;
  };

  home.sessionVariables = {
    "EDITOR" = "nvim";
  };

  home.packages = with pkgs; [
    babashka
    bat
    bitwarden-cli
    claude-code
    clj-kondo
    clojure-lsp
    cmake
    coreutils
    cosign
    curl
    discord
    dive
    fd
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
    neil
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
}

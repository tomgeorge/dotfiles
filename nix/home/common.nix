{ config, pkgs, ... }:

{
  home = {
    stateVersion = "24.11";
    shell = {
      enableFishIntegration = true;
    };
    sessionVariables = {
      "EDITOR" = "nvim";
    };
  };

  programs.home-manager.enable = true;

  programs.fish = {
    enable = true;
    shellAliases = {
      vi = "nvim";
      vim = "nvim";
      diff = "nvim -d";
      cd = "z";
      hmh = "man home-configuration.nix";
    };
    interactiveShellInit = ''
      set -g fish_key_bindings fish_vi_key_bindings
    '';
    plugins = [
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
    ];
  };

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

  home.packages = with pkgs; [
    bat
    cmake
    coreutils
    curl
    fd
    gettext
    github-cli
    gnupg
    htop
    lazygit
    neovim
    ninja
    nixd
    nixfmt
    ripgrep
    shellcheck
    tmux
    tree-sitter
    yazi
  ];
}

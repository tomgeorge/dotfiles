{
  config,
  pkgs,
  lib,
  ...
}:

{
  home = {
    stateVersion = "25.05";
    sessionVariables = {
      "EDITOR" = "nvim";
    };
  };

  programs.home-manager.enable = true;

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
}

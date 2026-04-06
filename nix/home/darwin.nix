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
}

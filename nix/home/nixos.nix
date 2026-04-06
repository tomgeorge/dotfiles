{ config, pkgs, ... }:

{
  home = {
    username = "tgeorge";
    homeDirectory = "/home/tgeorge";
    stateVersion = "25.05";
  };

  programs.bash = {
    enable = true;
  };

  programs.fish.shellAliases = {
    rebuild = "sudo nixos-rebuild switch --flake $HOME/git/dotfiles/nix#meerkat";
  };

  programs.vicinae.enable = true;
  programs.waybar.enable = true;

  wayland.windowManager.hyprland.extraConfig = ''
    exec-once = vicinae server
    bind = $mod, Space, exec, vicinae toggle
  '';

  home.packages = with pkgs; [
    vicinae
  ];
}

{ config, pkgs, ... }:

{
  home.username = "tgeorge";
  home.homeDirectory = "/home/tgeorge";
  home.stateVersion = "25.05";
  programs.bash = {
    enable = true;
  };
  home.packages = with pkgs; [
    nixd
    nixfmt
    neovim
    vicinae
  ];
  programs.vicinae.enable = true;
  programs.waybar.enable = true;
  wayland.windowManager.hyprland.extraConfig = ''
    exec-once = vicinae server
    bind = $mod, Space, exec, vicinae toggle
  '';
}

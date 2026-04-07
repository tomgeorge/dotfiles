{ config, pkgs, ... }:

{
  home = {
    username = "tgeorge";
    homeDirectory = "/home/tgeorge";
  };

  programs.bash = {
    enable = true;
  };

  programs.vicinae.enable = true;
  programs.waybar.enable = true;

  wayland.windowManager.hyprland.extraConfig = ''
    exec-once = vicinae server
    bind = $mod, Space, exec, vicinae toggle
  '';
}

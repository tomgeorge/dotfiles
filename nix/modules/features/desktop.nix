{
  inputs,
  config,
  lib,
  ...
}:

{
  flake.modules = {
    darwin.desktop =
      { pkgs, ... }:
      {
        environment.systemPackages = [
          pkgs.tailscale-gui
        ];
      };

    nixos.desktop =
      { pkgs, ... }:
      {
        environment.systemPackages = [ pkgs.hyprpaper ];

        services.displayManager.ly.enable = true;

        programs.firefox.enable = true;

        programs.hyprland = {
          enable = true;
          withUWSM = true;
          xwayland.enable = true;
        };
        programs.hyprlock.enable = true;
        services.hypridle.enable = true;

        # Pull in Linux-only HM config through the system module
        home-manager.sharedModules = [
          inputs.self.modules.homeManager.nixosDesktop
        ];
      };

    homeManager.nixosDesktop =
      { ... }:
      {
        programs.bash = {
          enable = true;
        };

        programs.noctalia-shell = {
          enable = true;
        };
        programs.vicinae.enable = true;
        programs.waybar.enable = true;

        wayland.windowManager.hyprland.extraConfig = ''
          exec-once = vicinae server
          bind = $mod, Space, exec, vicinae toggle
        '';
      };
  };
}

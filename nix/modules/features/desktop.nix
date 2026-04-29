{
  inputs,
  ...
}:

{
  flake.modules = {
    darwin.desktop =
      { pkgs, ... }:
      {
        homebrew.casks = [
          "tailscale-app"
        ];
      };

    nixos.desktop =
      { pkgs, ... }:
      {
        services.displayManager.ly.enable = true;
        programs.firefox.enable = true;
      };

    homeManager.desktop =
      { ... }:
      {
        imports = with inputs.self.modules.homeManager; [
          noctalia
        ];

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

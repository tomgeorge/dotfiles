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
        ];

        environment.systemPackages = [
          # Lands in /Applications/Nix Apps; dinky adds itself as a login item on first run.
          (pkgs.callPackage ../../pkgs/dinky.nix { })
        ];

        # Reads ~/.config/sketchybar, linked from dotfiles by link.sh.
        services.sketchybar.enable = true;

        # Settings dinky relies on (`dinky doctor` checks them). Keep Space order
        # fixed so workspace numbers hold, and let Cmd-Tab and Dock clicks use
        # dinky's fast Space switch instead of the slide.
        system.defaults.dock.mru-spaces = false;
        system.defaults.CustomUserPreferences."com.apple.dock".workspaces-auto-swoosh = false;
        # SketchyBar takes the menu bar's place.
        system.defaults.NSGlobalDomain._HIHideMenuBar = true;
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

{ inputs, ... }:

{
  flake.modules.darwin."Toms-MacBook-Pro" =
    { self, pkgs, ... }:
    {
      imports = with inputs.self.modules.darwin; [
        home-manager
        nix-homebrew
        tom
        apps
        desktop
        fish
        fonts
        shellTools
      ];

      networking.hostName = "Toms-MacBook-Pro";

      nixpkgs.config.allowUnfree = true;

      nix.settings.experimental-features = "nix-command flakes";

      environment.systemPackages = with pkgs; [
        openssl_3_6
        # Lands in /Applications/Nix Apps; dinky adds itself as a login item on first run.
        (callPackage ../../../pkgs/dinky.nix { })
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

      system.configurationRevision = self.rev or self.dirtyRev or null;
      system.stateVersion = 6;
    };
}

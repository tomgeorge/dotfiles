{ config, lib, ... }:

{
  flake.modules = {
    darwin.apps =
      { pkgs, config, ... }:
      {
        environment.systemPackages = with pkgs; [
          raycast
        ];

        homebrew.enable = true;
        homebrew.taps = builtins.attrNames config.nix-homebrew.taps;
        homebrew.onActivation.cleanup = "uninstall";
        homebrew.casks = [
          "betterdisplay"
          "claude"
          "discord"
          "fantastical"
          "hey-desktop"
          "mozilla-vpn"
          "rectangle"
          "spotify"
          "todoist-app"
          "tomatobar"
          "visual-studio-code"
          "zoom"
        ];
      };
  };
}

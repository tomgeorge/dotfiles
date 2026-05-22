{ config, lib, ... }:

{
  flake.modules = {
    darwin.apps =
      { pkgs, config, ... }:
      {
        environment.systemPackages = with pkgs; [
          discord
          raycast
        ];

        homebrew.enable = true;
        homebrew.taps = builtins.attrNames config.nix-homebrew.taps;
        homebrew.onActivation.cleanup = "uninstall";
        homebrew.casks = [
          "betterdisplay"
          "todoist-app"
          "fantastical"
          "visual-studio-code"
          "hey-desktop"
          "claude"
          "mozilla-vpn"
          "rectangle"
          "spotify"
        ];
      };
  };
}

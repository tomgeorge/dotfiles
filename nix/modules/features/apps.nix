{ config, lib, ... }:

{
  flake.modules = {
    darwin.apps =
      { pkgs, ... }:
      {
        environment.systemPackages = with pkgs; [
          discord
          raycast
        ];

        homebrew.enable = true;
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

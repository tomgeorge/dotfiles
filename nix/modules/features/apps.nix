{
  config,
  lib,
  inputs,
  ...
}:

{
  flake.modules = {
    homeManager.apps =
      { pkgs, ... }:
      {
        home.packages = [ inputs.hey-cli.packages.${pkgs.system}.default ];
      };

    darwin.apps =
      { pkgs, config, ... }:
      {
        environment.systemPackages = with pkgs; [
          raycast
        ];

        homebrew.enable = true;
        homebrew.taps = builtins.attrNames config.nix-homebrew.taps ++ [
          # Homebrew 6 refuses non-official taps unless marked trusted (see work-apps.nix).
          {
            name = "artemyurov/tomobar";
            trusted = true;
          }
        ];
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
          "tomobar"
          "visual-studio-code"
          "zoom"
        ];
      };
  };
}

{
  config,
  lib,
  inputs,
  ...
}:

{
  flake.modules = {
    homeManager.apps =
      { pkgs, lib, ... }:
      {
        home.packages = [
          inputs.hey-cli.packages.${pkgs.stdenv.hostPlatform.system}.default
        ]
        # Mac only for now: meerkat (NixOS) also imports this module.
        ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
          pkgs.google-chrome
          pkgs.slack
          pkgs.spotify
        ];
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
          "todoist-app"
          "tomobar"
          "visual-studio-code"
          "zoom"
        ];
      };
  };
}

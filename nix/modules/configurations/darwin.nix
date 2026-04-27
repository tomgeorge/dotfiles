{
  inputs,
  lib,
  config,
  ...
}:

let
  hosts = {
    "Toms-MacBook-Pro" = {
      username = "tgeorge";
      userFullName = "Tom George";
      userEmail = "tg8490@gmail.com";
    };
    "Toms-Work-MacBook-Pro" = {
      username = "tom.george";
      userFullName = "Tom George";
      userEmail = "thomas.george@chainguard.dev";
    };
  };
in
{
  imports = [ inputs.flake-parts.flakeModules.modules ];

  flake.darwinConfigurations = lib.mapAttrs (
    hostname: hostCfg:
    inputs.nix-darwin.lib.darwinSystem {
      specialArgs = {
        self = inputs.self;
      };
      modules = [
        {
          user = {
            inherit (hostCfg) username userFullName userEmail;
          };
          networking.hostName = hostname;
        }
        inputs.nix-homebrew.darwinModules.nix-homebrew
        {
          nix-homebrew = {
            enable = true;
            user = hostCfg.username;
            taps = {
              "homebrew/homebrew-code" = inputs.homebrew-core;
              "homebrew/homebrew-cask" = inputs.homebrew-cask;
            };
            mutableTaps = false;
          };
        }
        inputs.home-manager.darwinModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.${hostCfg.username} = {
            imports = builtins.attrValues (removeAttrs config.flake.modules.homeManager [ "nixosDesktop" ]);
            user = {
              inherit (hostCfg) username userFullName userEmail;
            };
          };
        }
      ]
      ++ builtins.attrValues config.flake.modules.darwin;
    }
  ) hosts;
}

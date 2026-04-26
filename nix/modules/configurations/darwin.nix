{
  inputs,
  config,
  ...
}:

let
  username = config.user.username;
in
{
  imports = [ inputs.flake-parts.flakeModules.modules ];

  flake = {
    darwinConfigurations."Toms-MacBook-Pro" = inputs.nix-darwin.lib.darwinSystem {
      specialArgs = {
        self = inputs.self;
      };
      modules = [
        inputs.nix-homebrew.darwinModules.nix-homebrew
        {
          nix-homebrew = {
            enable = true;
            user = username;
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
          home-manager.users.${username} = {
            imports = builtins.attrValues (removeAttrs config.flake.modules.homeManager [ "nixosDesktop" ]);
          };
        }
      ]
      ++ builtins.attrValues config.flake.modules.darwin;
    };
  };
}

{
  inputs,
  config,
  ...
}:

let
  username = config.user.username;
in
{
  flake = {
    nixosConfigurations.meerkat = inputs.nixpkgs.lib.nixosSystem {
      modules = [
        inputs.home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.${username} = {
            imports = builtins.attrValues (removeAttrs config.flake.modules.homeManager [ "nixosDesktop" ]);
          };
          home-manager.backupFileExtension = "backup";
        }
      ]
      ++ builtins.attrValues config.flake.modules.nixos;
    };
  };
}

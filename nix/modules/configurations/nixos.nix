{
  inputs,
  config,
  ...
}:

let
  hostCfg = {
    username = "tgeorge";
    userFullName = "Tom George";
    userEmail = "tg8490@gmail.com";
  };
in
{
  flake = {
    nixosConfigurations.meerkat = inputs.nixpkgs.lib.nixosSystem {
      modules = [
        {
          user = { inherit (hostCfg) username userFullName userEmail; };
        }
        inputs.home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.${hostCfg.username} = {
            imports = builtins.attrValues config.flake.modules.homeManager;
            user = { inherit (hostCfg) username userFullName userEmail; };
          };
          home-manager.backupFileExtension = "backup";
        }
      ]
      ++ builtins.attrValues config.flake.modules.nixos;
    };
  };
}

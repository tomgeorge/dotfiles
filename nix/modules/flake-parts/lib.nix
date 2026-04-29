{ inputs, lib, ... }:

{
  imports = [ inputs.flake-parts.flakeModules.modules ];

  options.flake.lib = lib.mkOption {
    type = lib.types.attrsOf lib.types.unspecified;
    default = { };
  };

  config.systems = [
    "aarch64-darwin"
    "x86_64-linux"
  ];

  config.flake.lib = {
    mkDarwin = system: name: {
      ${name} = inputs.nix-darwin.lib.darwinSystem {
        specialArgs = {
          self = inputs.self;
        };
        modules = [
          inputs.self.modules.darwin.${name}
          { nixpkgs.hostPlatform = lib.mkDefault system; }
        ];
      };
    };

    mkNixos = system: name: {
      ${name} = inputs.nixpkgs.lib.nixosSystem {
        modules = [
          inputs.self.modules.nixos.${name}
          { nixpkgs.hostPlatform = lib.mkDefault system; }
        ];
      };
    };
  };
}

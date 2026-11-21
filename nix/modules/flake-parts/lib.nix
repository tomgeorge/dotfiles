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

    # Standalone home-manager, for machines whose system Nix doesn't manage.
    # `module` names a flake.modules.homeManager entry, usually a user.
    mkHome = system: name: module: {
      ${name} = inputs.home-manager.lib.homeManagerConfiguration {
        pkgs = import inputs.nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
        modules = [ inputs.self.modules.homeManager.${module} ];
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

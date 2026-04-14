{
  description = "tgeorge's unified nix config";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };
    import-tree.url = "github:vic/import-tree";

    nix-darwin = {
      url = "github:nix-darwin/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    nix-homebrew.url = "github:zhaofengli/nix-homebrew";
    homebrew-core = {
      url = "github:homebrew/homebrew-core";
      flake = false;
    };
    homebrew-cask = {
      url = "github:homebrew/homebrew-cask";
      flake = false;
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      flake-parts,
      import-tree,
      nix-darwin,
      home-manager,
      nix-homebrew,
      homebrew-core,
      homebrew-cask,
      ...
    }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ (import-tree ./modules) ];
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];
      flake = {
        # macOS (nix-darwin)
        darwinConfigurations."Toms-MacBook-Pro" = nix-darwin.lib.darwinSystem {
          specialArgs = { inherit self; };
          modules = [
            ./hosts/macbook/default.nix
            self.modules.darwin.fish
            self.modules.darwin.shellTools
            self.modules.darwin.terminal
            self.modules.darwin.desktop
            self.modules.darwin.apps
            self.modules.darwin.fonts
            nix-homebrew.darwinModules.nix-homebrew
            {
              nix-homebrew = {
                enable = true;
                user = "tgeorge";
                taps = {
                  "homebrew/homebrew-code" = homebrew-core;
                  "homebrew/homebrew-cask" = homebrew-cask;
                };
                mutableTaps = false;
              };
            }
            home-manager.darwinModules.home-manager
            {
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.users.tgeorge = {
                imports = [
                  ./home
                  self.modules.homeManager.fish
                  self.modules.homeManager.shellTools
                  self.modules.homeManager.dev
                  self.modules.homeManager.terminal
                ];
              };
            }
          ];
        };

        # NixOS (meerkat desktop)
        nixosConfigurations.meerkat = nixpkgs.lib.nixosSystem {
          system = "x86_64-linux";
          modules = [
            ./hosts/meerkat/default.nix
            self.modules.nixos.fish
            self.modules.nixos.terminal
            self.modules.nixos.desktop
            home-manager.nixosModules.home-manager
            {
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.users.tgeorge = {
                imports = [
                  ./home
                  self.modules.homeManager.fish
                  self.modules.homeManager.shellTools
                  self.modules.homeManager.dev
                  self.modules.homeManager.terminal
                  self.modules.homeManager.desktop
                ];
              };
              home-manager.backupFileExtension = "backup";
            }
          ];
        };
      };
    };
}

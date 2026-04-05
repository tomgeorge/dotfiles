{
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:nix-darwin/nix-darwin/master";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";

    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

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
      nix-darwin,
      nixpkgs,
      nix-homebrew,
      homebrew-core,
      homebrew-cask,
      home-manager,
    }:
    let
      configuration =
        { pkgs, ... }:
        {
          nixpkgs.config.allowUnfree = true;
          # List packages installed in system profile. To search by name, run:
          # $ nix-env -qaP | grep wget
          environment = with pkgs; {
            systemPackages = [
              fish
              zsh
              openssl_3_6
              discord
            ];
            shells = [
              fish
              zsh
            ];
          };

          # Necessary for using flakes on this system.
          nix.settings.experimental-features = "nix-command flakes";

          users.users.tgeorge.home = "/Users/tgeorge";
          users.users.tgeorge.shell = pkgs.fish;

          # Enable alternative shell support in nix-darwin.
          programs.fish.enable = true;
          programs.zsh.enable = true;

          # Set Git commit hash for darwin-version.
          system.configurationRevision = self.rev or self.dirtyRev or null;

          # Used for backwards compatibility, please read the changelog before changing.
          # $ darwin-rebuild changelog
          system.stateVersion = 6;

          system.primaryUser = "tgeorge";

          # The platform the configuration will be used on.
          nixpkgs.hostPlatform = "aarch64-darwin";

          homebrew.enable = true;
          homebrew.enableFishIntegration = true;
          homebrew.enableZshIntegration = true;
          homebrew.casks = [
            "todoist-app"
            "fantastical"
            "visual-studio-code"
            "hey-desktop"
            "claude"
          ];
        };
    in
    {
      # Build darwin flake using:
      # $ darwin-rebuild build --flake .#Toms-MacBook-Pro
      darwinConfigurations."Toms-MacBook-Pro" = nix-darwin.lib.darwinSystem {
        modules = [
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
          configuration
          home-manager.darwinModules.home-manager
          {
            home-manager.useGlobalPkgs = true;
            home-manager.useUserPackages = true;
            home-manager.users.tgeorge = import ./home.nix;
          }
        ];
      };
    };
}

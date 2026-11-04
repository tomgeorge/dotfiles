{
  description = "tgeorge's unified nix config";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    # Only for pi-coding-agent: 1.5.0 fixes OSC 7501 status vanishing in Rex.
    # Drop once nixpkgs-unstable has pi >= 1.5.0.
    nixpkgs-master.url = "github:NixOS/nixpkgs/master";

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
    homebrew-chainguard = {
      url = "github:chainguard-dev/homebrew-tap";
      flake = false;
    };
    homebrew-schpet = {
      url = "github:schpet/homebrew-tap";
      flake = false;
    };
    homebrew-tomobar = {
      url = "github:ArtemYurov/homebrew-tomobar";
      flake = false;
    };
    noctalia = {
      url = "github:noctalia-dev/noctalia-shell";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # No nixpkgs.follows: hey's go.mod needs a newer go than our nixpkgs pin has.
    hey-cli.url = "github:basecamp/hey-cli";
    hunk = {
      url = "github:modem-dev/hunk";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs: inputs.flake-parts.lib.mkFlake { inherit inputs; } (inputs.import-tree ./modules);
}

{
  description = "Dev shell for the dotfiles repo (herdr plugins, go-herdrkit SDK, pi-router)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      piRouter = pkgs: pkgs.callPackage ./pi/router-service/nix/package.nix { };
    in
    {
      packages = forAllSystems (pkgs: {
        pi-router = piRouter pkgs;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            go_1_27
            gopls
            gotools # goimports
            golangci-lint
            delve
            jq # poking at the vendored schema
          ];
        };

        # Separate from `default` so the torch closure only loads in pi/router-service.
        router = pkgs.mkShell {
          packages = [
            (piRouter pkgs).devEnv
            pkgs.ruff
          ];
          PI_ROUTER_DEVSHELL = "1";
        };
      });
    };
}

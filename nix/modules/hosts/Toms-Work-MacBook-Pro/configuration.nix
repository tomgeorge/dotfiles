{ inputs, lib, ... }:

{
  flake.modules.darwin."Toms-Work-MacBook-Pro" =
    {
      self,
      pkgs,
      ...
    }:
    {
      imports = with inputs.self.modules.darwin; [
        home-manager
        nix-homebrew
        tom-work
        apps
        work-apps
        desktop
        fish
        fonts
        shellTools
        qemu
      ];

      home-manager.users."tom.george" = {
        programs.git = {
          settings = {
            user.name = "Tom George";
            user.email = "thomas.george@chainguard.dev";
          };
        };
        home.packages = [
          pkgs.google-cloud-sdk
          (pkgs.writeShellScriptBin "docker-credential-cgrdev" ''
            CHAINCTL_CONFIG="$HOME/.config/chainctl/devenv.yaml" exec docker-credential-cgr "$@"
          '')
        ];
        programs.fish.shellAliases = {
          chaindev = "CHAINCTL_CONFIG=$HOME/.config/chainctl/devenv.yaml chainctl";
        };
      };

      networking.hostName = "Toms-Work-MacBook-Pro";

      nixpkgs.config.allowUnfree = true;

      nix.settings.experimental-features = "nix-command flakes";

      environment.systemPackages = with pkgs; [
        openssl_3_6
      ];

      system.configurationRevision = self.rev or self.dirtyRev or null;
      system.stateVersion = 6;
    };
}

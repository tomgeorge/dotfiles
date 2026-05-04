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
          signing = {
            format = lib.mkForce "x509";
            signer = "gitsign";
          };
          settings = {
            user.name = "Tom George";
            user.email = "thomas.george@chainguard.dev";
            commit.gpgsign = lib.mkForce true;
            gitsign.connectorID = "https://accounts.google.com";
          };
        };
        home.packages = [
          pkgs.google-cloud-sdk
          pkgs.gitsign
        ];
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

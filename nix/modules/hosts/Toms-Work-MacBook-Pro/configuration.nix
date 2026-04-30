{ inputs, ... }:

{
  flake.modules.darwin."Toms-Work-MacBook-Pro" =
    { self, pkgs, ... }:
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
      ];

      home-manager.users."tom.george" = {
        programs.git = {
          signing = {
            format = "x509";
            program = "gitsign";
          };
          extraConfig = {
            commit.gpgsign = true;
            gitsign.connectorID = "https://accounts.google.com";
          };
        };
        home.packages = [ pkgs.gitsign ];
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

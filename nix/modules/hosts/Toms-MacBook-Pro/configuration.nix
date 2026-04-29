{ inputs, ... }:

{
  flake.modules.darwin."Toms-MacBook-Pro" =
    { self, pkgs, ... }:
    {
      imports = with inputs.self.modules.darwin; [
        home-manager
        nix-homebrew
        tom
        apps
        desktop
        fish
        fonts
        shellTools
        terminal
      ];

      networking.hostName = "Toms-MacBook-Pro";

      nixpkgs.config.allowUnfree = true;

      nix.settings.experimental-features = "nix-command flakes";

      environment.systemPackages = with pkgs; [
        openssl_3_6
      ];

      system.configurationRevision = self.rev or self.dirtyRev or null;
      system.stateVersion = 6;
    };
}

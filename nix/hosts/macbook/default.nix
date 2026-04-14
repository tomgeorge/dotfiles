{ self, pkgs, ... }:

{
  nixpkgs.config.allowUnfree = true;

  environment = with pkgs; {
    systemPackages = [
      openssl_3_6
    ];
  };

  nix.settings.experimental-features = "nix-command flakes";

  users.users.tgeorge.home = "/Users/tgeorge";

  system.configurationRevision = self.rev or self.dirtyRev or null;
  system.stateVersion = 6;
  system.primaryUser = "tgeorge";

  nixpkgs.hostPlatform = "aarch64-darwin";

}

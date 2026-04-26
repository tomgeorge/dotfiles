{ config, ... }:

let
  username = config.user.username;
in
{
  flake.modules = {
    darwin.macbook =
      { self, pkgs, ... }:
      {
        nixpkgs.config.allowUnfree = true;

        environment = with pkgs; {
          systemPackages = [
            openssl_3_6
          ];
        };

        nix.settings.experimental-features = "nix-command flakes";

        users.users.${username}.home = "/Users/${username}";

        system.configurationRevision = self.rev or self.dirtyRev or null;
        system.stateVersion = 6;
        system.primaryUser = username;

        nixpkgs.hostPlatform = "aarch64-darwin";
      };
  };
}

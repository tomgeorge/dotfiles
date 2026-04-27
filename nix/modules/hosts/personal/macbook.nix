{
  flake.modules = {
    darwin.macbook =
      {
        config,
        self,
        pkgs,
        ...
      }:
      let
        username = config.user.username;
      in
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

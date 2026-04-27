{
  flake.modules = {
    homeManager.base =
      { config, pkgs, ... }:
      let
        username = config.user.username;
      in
      {
        home = {
          inherit username;
          homeDirectory = if pkgs.stdenv.isDarwin then "/Users/${username}" else "/home/${username}";
          stateVersion = "25.05";
        };

        programs.home-manager.enable = true;
      };
  };
}

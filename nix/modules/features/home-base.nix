{ config, ... }:

let
  username = config.my.username;
in
{
  flake.modules = {
    homeManager.base =
      { pkgs, ... }:
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

{ config, lib, ... }:

{
  flake.modules = {
    homeManager.terminal =
      { pkgs, lib, ... }:
      {
        programs.wezterm = lib.mkIf pkgs.stdenv.isDarwin {
          enable = false;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };
      };
  };
}

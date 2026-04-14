{ config, lib, ... }:

{
  flake.modules = {
    darwin.terminal =
      { pkgs, ... }:
      {
        environment.systemPackages = [ pkgs.wezterm ];
      };

    nixos.terminal =
      { pkgs, ... }:
      {
        environment.systemPackages = [ pkgs.wezterm ];
      };

    homeManager.terminal =
      { pkgs, lib, ... }:
      {
        programs.wezterm = lib.mkIf pkgs.stdenv.isDarwin {
          enable = true;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };
      };
  };
}

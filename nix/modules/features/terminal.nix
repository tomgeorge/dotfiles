{ config, lib, ... }:

let
  systemTerminal =
    { pkgs, ... }:
    {
      environment.systemPackages = [ pkgs.wezterm ];
    };
in
{
  flake.modules = {
    darwin.terminal = systemTerminal;
    nixos.terminal = systemTerminal;

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

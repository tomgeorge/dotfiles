{ config, lib, ... }:

{
  flake.modules = {
    darwin.fonts =
      { pkgs, ... }:
      {
        fonts.packages = with pkgs; [
          dejavu_fonts
          nerd-fonts.fira-code
          jetbrains-mono
        ];
      };
  };
}

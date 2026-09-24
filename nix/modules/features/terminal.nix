{ config, lib, ... }:

{
  flake.modules = {
    homeManager.terminal =
      { pkgs, lib, ... }:
      {
        programs.wezterm = lib.mkIf pkgs.stdenv.isDarwin {
          enable = true;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };

        # ponytail: package only; config lives in dotfiles/ghostty, symlinked by link.sh
        # (nixpkgs `ghostty` is linux-only, hence -bin on darwin)
        home.packages = [ (if pkgs.stdenv.isDarwin then pkgs.ghostty-bin else pkgs.ghostty) ];
      };
  };
}

{ config, lib, ... }:

{
  flake.modules = {
    homeManager.terminal =
      { pkgs, lib, ... }:
      {
        programs.wezterm = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
          enable = true;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };

        # ponytail: package only; config lives in dotfiles/ghostty, symlinked by link.sh
        # (nixpkgs `ghostty` is linux-only, hence -bin on darwin)
        home.packages = [
          (if pkgs.stdenv.hostPlatform.isDarwin then pkgs.ghostty-bin else pkgs.ghostty)
        ]
        # Mac only for now: the Linux release needs its Electron patched for NixOS.
        ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
          (pkgs.callPackage ../../pkgs/terminal-browser.nix { })
        ];
      };
  };
}

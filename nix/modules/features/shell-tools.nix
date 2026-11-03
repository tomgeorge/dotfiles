{ config, lib, ... }:

{
  flake.modules = {
    darwin.shellTools =
      { pkgs, ... }:
      {
        environment.systemPackages = [ pkgs.zsh ];
        environment.shells = [ pkgs.zsh ];

        programs.zsh.enable = true;

        # Rex puts its CLI dir first on PATH, then nix-darwin resets PATH to a
        # fixed list; put it back. Guarded because it's empty outside Rex.
        environment.interactiveShellInit = ''
          if [ -n "$REX_BIN_DIR" ]; then
            export PATH="$REX_BIN_DIR:$PATH"
          fi
        '';

        homebrew.enableZshIntegration = true;
      };

    homeManager.shellTools =
      { pkgs, ... }:
      {
        programs.zoxide = {
          enable = true;
          enableFishIntegration = true;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };

        programs.starship = {
          enable = true;
          presets = [
            "nerd-font-symbols"
          ];
        };

        programs.fzf = {
          enable = true;
          enableFishIntegration = true;
          enableZshIntegration = true;
          enableBashIntegration = true;
        };

        programs.direnv = {
          enable = true;
          nix-direnv.enable = true;
          enableFishIntegration = true;
          enableZshIntegration = true;
          enableBashIntegration = true;
        };

        programs.bash = lib.mkIf (!pkgs.stdenv.hostPlatform.isDarwin) {
          enable = true;
        };
      };
  };
}

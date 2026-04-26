{ config, lib, ... }:

{
  flake.modules = {
    darwin.shellTools =
      { pkgs, ... }:
      {
        environment.systemPackages = [ pkgs.zsh ];
        environment.shells = [ pkgs.zsh ];

        programs.zsh.enable = true;

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

        programs.bash = lib.mkIf (!pkgs.stdenv.isDarwin) {
          enable = true;
        };
      };
  };
}

{ lib, ... }:

{
  flake.modules = {
    homeManager.dev =
      { config, pkgs, ... }:
      let
        inherit (config.user) userFullName userEmail gpgKeyId;
        hasGpgKey = gpgKeyId != "";
      in
      {
        home.sessionVariables = {
          "EDITOR" = "nvim";
        };

        programs.git = {
          enable = true;
          settings = {
            user.name = userFullName;
            user.email = userEmail;
            user.signingkey = lib.mkIf hasGpgKey gpgKeyId;
            commit.gpgsign = hasGpgKey;
            init.defaultBranch = "main";
          };
          signing.format = "openpgp";
        };

        programs.gpg = {
          enable = true;
        };

        programs.mise = {
          enable = true;
          enableFishIntegration = true;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };

        programs.claude-code = lib.mkIf pkgs.stdenv.isDarwin {
          enable = true;
        };

        home.packages = with pkgs; [
          bat
          bitwarden-cli
          claude-code
          coreutils
          curl
          fd
          flyctl
          github-cli
          gnupg
          gnutls
          htop
          lazygit
          neovim
          pass
          ripgrep
          stow
          tmux
          yazi
        ];
      };
  };
}

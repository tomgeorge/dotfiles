{ lib, ... }:

{
  flake.modules = {
    homeManager.dev =
      { config, pkgs, ... }:
      let
        inherit (config.user) userFullName userEmail gpgKeyId;
        hasGpgKey = gpgKeyId != "";
        hunk = pkgs.callPackage ../../pkgs/hunk.nix { };
      in
      {
        home.sessionVariables = {
          "EDITOR" = "nvim";
          "GPG_TTY" = "$(tty)";
        };

        services.gpg-agent = {
          enable = true;
          pinentry.package = pkgs.pinentry_mac;
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
          settings = {
            personal-cipher-preferences = "AES256 AES192 AES";
            personal-digest-preferences = "SHA512 SHA384 SHA256";
            personal-compress-preferences = "ZLIB BZIP2 ZIP Uncompressed";
            default-preference-list = "SHA512 SHA384 SHA256 AES256 AES192 AES ZLIB BZIP2 ZIP Uncompressed";
            cert-digest-algo = "SHA512";
            s2k-digest-algo = "SHA512";
            s2k-cipher-algo = "AES256";
            charset = "utf-8";
            no-comments = true;
            no-emit-version = true;
            no-greeting = true;
            keyid-format = "0xlong";
            list-options = "show-uid-validity";
            verify-options = "show-uid-validity";
            with-fingerprint = true;
            require-cross-certification = true;
            require-secmem = true;
            no-symkey-cache = true;
            armor = true;
            use-agent = true;
            throw-keyids = true;
          };
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
          hunk
          jq
          lazygit
          neovim
          pass
          ripgrep
          stow
          tmux
          yazi
          yq-go
        ];
      };
  };
}

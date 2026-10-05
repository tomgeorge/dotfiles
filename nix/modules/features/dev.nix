{ lib, ... }:

{
  flake.modules = {
    homeManager.dev =
      { config, pkgs, ... }:
      let
        inherit (config.user) userFullName userEmail gpgKeyId;
        hasGpgKey = gpgKeyId != "";
        hunk = pkgs.callPackage ../../pkgs/hunk.nix { };
        # ketch 0.14.0's tests isolate config via XDG_CONFIG_HOME, which Go
        # ignores on macOS, so they write to the read-only sandbox $HOME and
        # fail. The binary itself is fine. Drop once nixpkgs fixes the package.
        ketch = pkgs.ketch.overrideAttrs { doCheck = false; };
      in
      {
        home.sessionVariables = {
          "EDITOR" = "nvim";
          "GPG_TTY" = "$(tty)";
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

        services.gpg-agent = {
          enable = true;
          defaultCacheTtl = 600;
          maxCacheTtl = 7200;
          pinentry.package = if pkgs.stdenv.hostPlatform.isDarwin then pkgs.pinentry_mac else pkgs.pinentry-curses;
        };

        # Upstream gnupg can't receive launchd-passed sockets, so the HM launchd
        # agent dies with "file descriptor 3 must be valid in --supervised mode"
        # and KeepAlive restarts it every 10s forever. gpg autostarts its own
        # agent on ~/.gnupg/S.gpg-agent anyway, so drop the broken service.
        launchd.agents.gpg-agent.enable = lib.mkForce false;

        programs.mise = {
          enable = true;
          enableFishIntegration = true;
          enableBashIntegration = true;
          enableZshIntegration = true;
        };

        programs.claude-code = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
          enable = true;
        };

        home.packages = with pkgs; [
          agent-browser
          bat
          bitwarden-cli
          claude-code
          codex
          coreutils
          cue
          curl
          fd
          flyctl
          github-cli
          gnupg
          gnutls
          golangci-lint
          herdr
          htop
          hunk
          jq
          ketch
          lazygit
          mkcert
          neovim
          nodejs
          pi-coding-agent
          oras
          pass
          ripgrep
          rlwrap
          slides
          stow
          tmux
          tree-sitter
          yazi
          yq-go
        ];
      };

    homeManager.devWork =
      { config, pkgs, ... }:
      let
        gnupgHome = config.programs.gpg.homedir;
      in
      {
        # Temporary: diagnose what resets the YubiKey (and drops the cached
        # PIN) when agents sign commits. Remove once found.
        programs.gpg.scdaemonSettings = {
          log-file = "${gnupgHome}/scdaemon.log";
          debug-level = "basic";
        };
        services.gpg-agent = {
          verbose = true;
          extraConfig = ''
            log-file ${gnupgHome}/gpg-agent.log
          '';
        };

        home.packages = [
          # incident.io CLI; not in nixpkgs.
          (pkgs.callPackage ../../pkgs/inc.nix { })
        ];
      };
  };
}

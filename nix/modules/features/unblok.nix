{
  flake.modules = {
    # The unblok workstation: only what unblok shells out to. pi comes from hm.pi.
    homeManager.unblok =
      { config, pkgs, ... }:
      {
        # No signing: there's no GPG key on that machine.
        programs.git = {
          enable = true;
          settings = {
            user.name = config.user.userFullName;
            user.email = config.user.userEmail;
            init.defaultBranch = "main";
            # What `gh auth setup-git` writes; it can't here, because
            # home-manager owns the git config. unblok clones over HTTPS.
            credential = {
              "https://github.com".helper = [
                ""
                "!${pkgs.gh}/bin/gh auth git-credential"
              ];
              "https://gist.github.com".helper = [
                ""
                "!${pkgs.gh}/bin/gh auth git-credential"
              ];
            };
          };
        };

        home.packages = [
          pkgs.gh
          # pi installs its settings.packages with npm; pi-anthropic-auth among
          # them keeps the review agents on the Anthropic subscription.
          pkgs.nodejs
          (pkgs.callPackage ../../pkgs/linear-cli.nix { })
        ];

        # unblok's install.sh links `unblok` here, and review agents run it from
        # login shells.
        home.sessionPath = [ "$HOME/.local/bin" ];
      };
  };
}

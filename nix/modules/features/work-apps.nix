{
  flake.modules = {
    darwin.work-apps = {
      # Homebrew 6.0.0 enabled HOMEBREW_REQUIRE_TAP_TRUST by default, which refuses
      # to load formulae from non-official taps unless marked trusted in the Brewfile.
      homebrew.taps = [
        {
          name = "chainguard-dev/tap";
          trusted = true;
        }
        {
          name = "schpet/tap";
          trusted = true;
        }
      ];
      homebrew.brews = [
        "chainctl"
        # schpet/linear-cli — the `linear` command-line tool (not in nixpkgs).
        "schpet/tap/linear"
      ];
      homebrew.casks = [
        "orbstack"
        "linear"
      ];
    };
  };
}

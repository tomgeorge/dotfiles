let
  # Collect garbage weekly, keeping two weeks of generations to roll back to.
  options = "--delete-older-than 14d";
in
{
  flake.modules = {
    darwin.nix-gc.nix.gc = {
      automatic = true;
      inherit options;
    };
    nixos.nix-gc.nix.gc = {
      automatic = true;
      dates = "weekly";
      inherit options;
    };
  };
}

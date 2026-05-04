{ inputs, ... }:

{
  flake.modules.darwin.nix-homebrew =
    { config, ... }:
    {
      imports = [ inputs.nix-homebrew.darwinModules.nix-homebrew ];

      nix-homebrew = {
        enable = true;
        user = config.user.username;
        taps = {
          "homebrew/homebrew-core" = inputs.homebrew-core;
          "homebrew/homebrew-cask" = inputs.homebrew-cask;
          "chainguard-dev/homebrew-tap" = inputs.homebrew-chainguard;
        };
        mutableTaps = false;
      };
    };
}

{
  flake.modules = {
    # Separate from dev so machines can leave fut out: it doesn't link on Linux
    # yet (GNU ld rejects the Zig-built libghostty objects).
    homeManager.fut =
      { pkgs, ... }:
      let
        fut = pkgs.callPackage ../../pkgs/fut.nix { };
      in
      {
        home.packages = [ fut ];

        # fut/config.toml (linked by link.sh) lists these by stable path.
        xdg.configFile."fut/extensions".source = "${fut.extensions}/share/fut/extensions";
      };
  };
}

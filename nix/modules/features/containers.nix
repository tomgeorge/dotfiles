{
  flake.modules = {
    homeManager.containers =
      { pkgs, ... }:
      {
        home.packages = with pkgs; [
          crane
          dive
          grype
          k9s
          kind
          ko
          kubectl
          kubectx
          podman
          podman-tui
          skopeo
        ];
      };

    # GUI, so separate from the CLI tools above for headless machines.
    homeManager.containersDesktop =
      { pkgs, ... }:
      {
        home.packages = [ pkgs.podman-desktop ];
      };
  };
}

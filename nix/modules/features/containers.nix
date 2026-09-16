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
          podman-desktop
          podman-tui
          skopeo
        ];
      };
  };
}

{
  flake.modules = {
    homeManager.containers =
      { pkgs, ... }:
      {
        home.packages = with pkgs; [
          dive
          k9s
          kind
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

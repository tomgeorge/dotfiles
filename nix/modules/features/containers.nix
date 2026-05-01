{
  flake.modules = {
    homeManager.containers =
      { pkgs, ... }:
      {
        programs.fish.shellAliases = {
          docker = "podman";
        };
        programs.zsh.shellAliases = {
          docker = "podman";
        };
        programs.bash.shellAliases = {
          docker = "podman";
        };

        home.packages = with pkgs; [
          crane
          dive
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

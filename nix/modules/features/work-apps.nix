{
  flake.modules = {
    darwin.work-apps =
      { pkgs, ... }:
      {
        homebrew.casks = [
          "linear-linear"
        ];
        home.packages = with pkgs; [
          line-awesome
        ];
      };
  };
}

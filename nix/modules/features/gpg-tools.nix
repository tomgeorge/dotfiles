{ ... }:

{
  flake.modules = {
    homeManager.gpgTools =
      { pkgs, ... }:
      {
        home.packages = with pkgs; [
          paperkey
        ];
      };
  };
}

{
  flake.modules = {
    homeManager.langs =
      { pkgs, ... }:
      {
        home.packages = with pkgs; [
          apko
          babashka
          # balena-cli # ld64 fortify hardening crash; re-enable once nixos/nixpkgs#536365 reaches nixpkgs-unstable
          cmake
          cosign
          beamPackages.erlang
          gettext
          melange
          neil
          ninja
          sqlc
          templ
          terraform-ls
        ];
      };
  };
}

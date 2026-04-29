{
  flake.modules = {
    homeManager.langs =
      { pkgs, ... }:
      {
        home.packages = with pkgs; [
          apko
          babashka
          balena-cli
          cmake
          cosign
          erlang
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

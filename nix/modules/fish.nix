{ config, lib, ... }:

{
  flake.modules = {
    darwin.fish =
      { pkgs, ... }:
      {
        programs.fish.enable = true;

        environment.systemPackages = [ pkgs.fish ];
        environment.shells = [ pkgs.fish ];

        users.users.tgeorge.shell = pkgs.fish;

        homebrew.enableFishIntegration = true;

      };

    nixos.fish =
      { pkgs, ... }:
      {
        programs.fish.enable = true;

        users.users.tgeorge.shell = pkgs.fish;
      };

    homeManager.fish =
      { pkgs, ... }:
      {
        home.shell.enableFishIntegration = true;

        programs.fish = {
          enable = true;
          shellAliases = {
            vi = "nvim";
            vim = "nvim";
            diff = "nvim -d";
            cd = "z";
            hmh = "man home-configuration.nix";
            rebuild =
              if pkgs.stdenv.isDarwin then
                "sudo darwin-rebuild switch --flake $HOME/git/dotfiles/nix"
              else
                "sudo nixos-rebuild switch --flake $HOME/git/dotfiles/nix#meerkat";
          };
          interactiveShellInit = ''
            set -g fish_key_bindings fish_vi_key_bindings
          '';
          plugins = [
            {
              name = "fzf.fish";
              src = pkgs.fetchFromGitHub {
                owner = "PatrickF1";
                repo = "fzf.fish";
                rev = "0069dbbe06cc05482bfb13063b4b4eac26318992";
                hash = "sha256-H7HgYT+okuVXo2SinrSs+hxAKCn4Q4su7oMbebKd/7s=";
              };
            }
          ];
        };
      };
  };
}

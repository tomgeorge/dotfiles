{ config, ... }:

let
  username = config.my.username;
in
{
  flake.modules = {
    nixos.meerkat =
      {
        config,
        lib,
        pkgs,
        ...
      }:
      {
        imports = [
          ./_hardware-configuration.nix
        ];

        nixpkgs.config.allowUnfree = true;

        boot.loader.systemd-boot.enable = true;
        boot.loader.efi.canTouchEfiVariables = true;

        networking.hostName = "meerkat";
        networking.networkmanager.enable = true;
        networking.wireless.enable = true;

        time.timeZone = "America/New_York";

        users.users.${username} = {
          isNormalUser = true;
          extraGroups = [
            "wheel"
            "networkmanager"
          ];
          packages = with pkgs; [
            tree
          ];
        };

        environment.systemPackages = with pkgs; [
          vim
          wget
          kitty
          git
        ];

        nix.settings.experimental-features = [
          "nix-command"
          "flakes"
        ];

        services.openssh.enable = true;

        system.stateVersion = "25.11";
      };
  };
}

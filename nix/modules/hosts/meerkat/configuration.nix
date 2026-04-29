{ inputs, ... }:

{
  flake.modules.nixos.meerkat =
    { config, pkgs, ... }:
    {
      imports = [
        ./_hardware-configuration.nix
      ]
      ++ (with inputs.self.modules.nixos; [
        home-manager
        tom
        desktop
        fish
      ]);

      # Add Hyprland/noctalia HM modules for this host (not on macbooks)
      home-manager.users.tgeorge.imports = with inputs.self.modules.homeManager; [
        desktop
      ];

      nixpkgs.config.allowUnfree = true;

      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;

      networking.hostName = "meerkat";
      networking.networkmanager.enable = true;
      networking.wireless.enable = true;

      time.timeZone = "America/New_York";

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
}

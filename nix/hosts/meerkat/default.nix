{
  config,
  lib,
  pkgs,
  ...
}:

{
  imports = [
    ./hardware-configuration.nix
  ];

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  networking.hostName = "meerkat";
  networking.networkmanager.enable = true;
  networking.wireless.enable = true;

  time.timeZone = "America/New_York";

  users.users.tgeorge = {
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
    wezterm
    git
    hyprpaper
  ];

  services.displayManager.ly.enable = true;
  programs.firefox.enable = true;

  programs.hyprland = {
    enable = true;
    withUWSM = true;
    xwayland.enable = true;
  };
  programs.hyprlock.enable = true;
  services.hypridle.enable = true;

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  services.openssh.enable = true;

  system.stateVersion = "25.11";
}

{ self, pkgs, ... }:

{
  nixpkgs.config.allowUnfree = true;

  environment = with pkgs; {
    systemPackages = [
      fish
      zsh
      openssl_3_6
      discord
      raycast
      wezterm
    ];
    shells = [
      fish
      zsh
    ];
  };

  fonts.packages = with pkgs; [
    dejavu_fonts
    nerd-fonts.fira-code
    jetbrains-mono
  ];

  nix.settings.experimental-features = "nix-command flakes";

  users.users.tgeorge.home = "/Users/tgeorge";
  users.users.tgeorge.shell = pkgs.fish;

  programs.fish.enable = true;
  programs.zsh.enable = true;

  system.configurationRevision = self.rev or self.dirtyRev or null;
  system.stateVersion = 6;
  system.primaryUser = "tgeorge";

  nixpkgs.hostPlatform = "aarch64-darwin";

  homebrew.enable = true;
  homebrew.enableFishIntegration = true;
  homebrew.enableZshIntegration = true;
  homebrew.casks = [
    "todoist-app"
    "fantastical"
    "visual-studio-code"
    "hey-desktop"
    "claude"
    "mozilla-vpn"
    "rectangle"
    "zoom"
    "spotify"
  ];
}

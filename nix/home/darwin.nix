{ config, pkgs, ... }:

{
  home = {
    username = "tgeorge";
    homeDirectory = "/Users/tgeorge";
  };

  programs.claude-code = {
    enable = true;
  };

  programs.wezterm = {
    enable = true;
    enableBashIntegration = true;
    enableZshIntegration = true;
  };
}

{ ... }:

{
  flake.modules = {
    # Quiet agent check-in across HEY, Todoist, and Fantastical (pi/prompts/checkin.md).
    # It notifies only when something needs attention. Personal machine only: the
    # accounts are personal. macOS only, because it uses launchd and osascript.
    homeManager.piCheckin =
      {
        config,
        lib,
        pkgs,
        ...
      }:
      let
        home = config.home.homeDirectory;
        logFile = "${home}/Library/Logs/pi-checkin.log";
        # Twice a day on weekdays: a morning start and an after-lunch re-check.
        times = [
          {
            Hour = 8;
            Minute = 30;
          }
          {
            Hour = 13;
            Minute = 0;
          }
        ];
      in
      lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
        launchd.agents.pi-checkin = {
          enable = true;
          config = {
            ProgramArguments = [
              "/bin/bash"
              "${home}/git/dotfiles/pi/checkin/run.sh"
            ];
            # launchd starts with a bare PATH; pi, node, and git come from the nix profile.
            EnvironmentVariables.PATH = lib.concatStringsSep ":" [
              "/etc/profiles/per-user/${config.home.username}/bin"
              "/run/current-system/sw/bin"
              "/usr/bin"
              "/bin"
            ];
            StartCalendarInterval = lib.concatMap (t: map (d: t // { Weekday = d; }) [ 1 2 3 4 5 ]) times;
            StandardOutPath = logFile;
            StandardErrorPath = logFile;
          };
        };
      };
  };
}

{
  flake.modules = {
    # The Rex server and CLI for Linux machines that the Mac's Rex app connects
    # to. On the Mac, the app ships its own rex.
    homeManager.rex =
      { lib, pkgs, ... }:
      {
        home.packages = [ (pkgs.callPackage ../../pkgs/rex.nix { }) ];

        # The variables below only reach shells that load home-manager's
        # session variables, which needs a managed shell config.
        programs.bash.enable = lib.mkDefault true;

        # The server runs as a system service (workstation/pet-startup.sh) with
        # its sockets in /run/rex, not in the logind-managed /run/user/<uid>.
        # Point the CLI there, and never let it start a second server.
        home.sessionVariables = {
          REX_RUNTIME_DIR = "/run/rex";
          REX_AUTOSTART = "0";
        };
      };
  };
}

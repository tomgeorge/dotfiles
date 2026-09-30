{ ... }:

{
  flake.modules = {
    # Local model router for pi subagents (pi/router-service). macOS only for now: the
    # `tom` user is also imported on meerkat, so everything is behind isDarwin.
    homeManager.piRouter =
      {
        config,
        lib,
        pkgs,
        ...
      }:
      let
        # Same derivation as the root flake's `pi-router` package. The system flake is
        # evaluated from the git repo, so paths outside nix/ resolve.
        piRouter = pkgs.callPackage ../../../pi/router-service/nix/package.nix { };
        logFile = "${config.home.homeDirectory}/Library/Logs/pi-router.log";
      in
      lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
        launchd.agents.pi-router = {
          enable = true;
          config = {
            ProgramArguments = [ (lib.getExe piRouter) ];
            EnvironmentVariables = {
              PI_ROUTER_HOST = "127.0.0.1";
              PI_ROUTER_PORT = "8765";
              PI_ROUTER_DEVICE = "mps";
              PI_ROUTER_BACKENDS = "arch-router,laya-typed-decisions";
              # Never download at startup; `make router-warm` fetches the weights. Model
              # revisions are pinned in pi_router/service.py.
              HF_HUB_OFFLINE = "1";
            };
            RunAtLoad = true;
            KeepAlive = {
              Crashed = true;
              SuccessfulExit = false;
            };
            # A missing model cache fails fast; don't restart in a tight loop.
            ThrottleInterval = 30;
            StandardOutPath = logFile;
            StandardErrorPath = logFile;
          };
        };
      };
  };
}

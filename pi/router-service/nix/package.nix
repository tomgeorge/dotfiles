# pi-router: local model router for pi subagents. Used by the root flake (package + dev shell)
# and by the nix-darwin launchd agent in nix/modules/features/pi-router.nix.
{
  lib,
  python3,
}:

let
  py = python3.pkgs;
  laya = py.callPackage ./laya.nix { };
  dependencies = [
    laya
    py.fastapi
    py.torch
    py.transformers
    py.uvicorn
  ];
  testDependencies = [
    py.httpx2
    py.pytest
  ];
in
py.buildPythonApplication {
  pname = "pi-router";
  version = "0.1.0";
  pyproject = true;

  # Only what the build and tests read, so editing eval data or docs doesn't rebuild.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../pyproject.toml
      ../src
      ../tests
    ];
  };

  build-system = [ py.hatchling ];
  inherit dependencies;
  nativeCheckInputs = [ py.pytestCheckHook ] ++ testDependencies;
  pythonImportsCheck = [ "pi_router.service" ];

  passthru = {
    inherit laya;
    # Everything needed to run and test from the checkout (the `router` dev shell).
    devEnv = python3.withPackages (_: dependencies ++ testDependencies);
  };

  meta = {
    description = "Rank subagent tasks with Arch-Router and Laya";
    mainProgram = "pi-router-serve";
  };
}

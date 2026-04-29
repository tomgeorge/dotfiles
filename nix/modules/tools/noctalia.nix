{ inputs, ... }:

{
  flake.modules.homeManager.noctalia = {
    imports = [ inputs.noctalia.homeModules.default ];
  };
}

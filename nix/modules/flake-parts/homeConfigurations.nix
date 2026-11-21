{ lib, flake-parts-lib, ... }:

{
  options.flake = flake-parts-lib.mkSubmoduleOptions {
    homeConfigurations = lib.mkOption {
      type = lib.types.lazyAttrsOf lib.types.raw;
      default = { };
    };
  };
}

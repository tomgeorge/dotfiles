{ lib, ... }:

let
  userOptions = {
    options.user = {
      username = lib.mkOption { type = lib.types.str; };
      userFullName = lib.mkOption { type = lib.types.str; };
      userEmail = lib.mkOption { type = lib.types.str; };
      gpgKeyId = lib.mkOption {
        type = lib.types.str;
        default = "";
      };
    };
  };
in
{
  flake.modules = {
    darwin.userOptions = userOptions;
    nixos.userOptions = userOptions;
    homeManager.userOptions = userOptions;
  };
}

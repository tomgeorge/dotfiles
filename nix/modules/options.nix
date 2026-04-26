{ lib, ... }:

{
  options.my = {
    username = lib.mkOption {
      type = lib.types.str;
      default = "tgeorge";
      description = "Primary username for the system";
    };
  };
}

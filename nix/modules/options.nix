{ lib, ... }:

{
  options.my = {
    username = lib.mkOption {
      type = lib.types.str;
      default = "tgeorge";
      description = "Primary username for the system";
    };
    gitName = lib.mkOption {
      type = lib.types.str;
      default = "Tom George";
      description = "Git user name";
    };
    gitEmail = lib.mkOption {
      type = lib.types.str;
      default = "tg8490@gmail.com";
      description = "Git email address";
    };
  };
}

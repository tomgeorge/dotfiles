{ lib, ... }:

{
  options.user = {
    username = lib.mkOption {
      type = lib.types.str;
      default = "tgeorge";
    };
    userFullName = lib.mkOption {
      type = lib.types.str;
      default = "Tom George";
    };
    userEmaail = lib.mkOption {
      type = lib.types.str;
      default = "tg8490@gmail.com";
    };
  };
}

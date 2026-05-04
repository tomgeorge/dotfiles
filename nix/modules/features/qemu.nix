{
  flake.modules = {
    darwin.qemu =
      { pkgs, ... }:
      {
        environment.systemPackages = with pkgs; [
          qemu
        ];
      };
  };
}

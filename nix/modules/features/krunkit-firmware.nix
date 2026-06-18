{
  # The nixpkgs `krunkit` package ships only `bin/krunkit` and omits the EFI
  # firmware blob (`KRUN_EFI.silent.fd`) that the upstream build produces under
  # `edk2/`. Without it, `podman machine` (libkrun provider) fails to boot with:
  #   Error: can't find a firmware to load
  # because krunkit looks for `share/krunkit/KRUN_EFI.silent.fd` relative to its
  # own binary. podman pulls krunkit into its wrapped closure, so overriding the
  # package here is enough to fix `podman machine`.
  #
  # Upstream fix: https://github.com/NixOS/nixpkgs/pull/525378
  # Remove this overlay once that PR has merged and landed in our nixpkgs pin.
  flake.modules.darwin.krunkit-firmware = {
    nixpkgs.overlays = [
      (final: prev: {
        krunkit = prev.krunkit.overrideAttrs (old: {
          postInstall = (old.postInstall or "") + ''
            install -Dm444 edk2/KRUN_EFI.silent.fd $out/share/krunkit/KRUN_EFI.silent.fd
          '';
        });
      })
    ];
  };
}

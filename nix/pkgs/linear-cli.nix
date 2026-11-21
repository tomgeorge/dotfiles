{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
}:

# schpet/linear-cli's Linux release, a Deno-compiled binary. The Mac gets the
# same tool from the schpet/tap Homebrew formula (work-apps.nix).
stdenv.mkDerivation (finalAttrs: {
  pname = "linear-cli";
  version = "2.0.0";

  src = fetchurl {
    url = "https://github.com/schpet/linear-cli/releases/download/v${finalAttrs.version}/linear-x86_64-unknown-linux-gnu.tar.xz";
    hash = "sha256-r/tZRnLC8iDO9o+nz+uBOUXEAQeJpLjMLA5GRo/reHA=";
  };

  # Links against libgcc_s as well as glibc.
  nativeBuildInputs = [ autoPatchelfHook ];
  buildInputs = [ stdenv.cc.cc.lib ];

  dontConfigure = true;
  dontBuild = true;
  # Deno appends the bundled program to the ELF; stripping would cut it off.
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 linear $out/bin/linear
    runHook postInstall
  '';

  meta = {
    description = "Linear from the command line";
    homepage = "https://github.com/schpet/linear-cli";
    license = lib.licenses.isc;
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    mainProgram = "linear";
  };
})

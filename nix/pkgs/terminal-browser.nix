{
  lib,
  stdenvNoCC,
  fetchurl,
}:

let
  # Rewritten by update-terminal-browser.sh.
  version = "0.16.3";
  channel = "stable";
  sha256 = {
    aarch64-darwin = "42e894a411f54ca9a55237f6c654c9c7a90f45966ff74d4d9b36ae0d608dbe87";
    x86_64-darwin = "e867238ff3c4717ea129a2af996dfbbf8d2783bb593d72779b158feac68bfb24";
  };
  target =
    {
      aarch64-darwin = "darwin-arm64";
      x86_64-darwin = "darwin-x64";
    }
    .${stdenvNoCC.hostPlatform.system}
      or (throw "terminal-browser: no release for ${stdenvNoCC.hostPlatform.system}");
in
stdenvNoCC.mkDerivation {
  pname = "terminal-browser";
  inherit version;

  src = fetchurl {
    url = "https://terminal-browser.sh/install/dl/${channel}/v${version}/terminal-browser-${target}.tar.gz";
    sha256 = sha256.${stdenvNoCC.hostPlatform.system};
  };

  dontConfigure = true;
  dontBuild = true;
  # The bundled Electron app is Developer ID signed; stripping or patching any
  # of it would break the signature and macOS would refuse to run it.
  dontFixup = true;

  # Laid out as upstream's installer does. The launcher resolves its own
  # symlinks to find the rest of the release, so bin/ can point into it.
  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/terminal-browser $out/bin
    cp -R . $out/share/terminal-browser
    ln -s ../share/terminal-browser/bin/terminal-browser $out/bin/terminal-browser
    runHook postInstall
  '';

  meta = {
    description = "A real browser inside your terminal";
    homepage = "https://terminal-browser.com";
    license = lib.licenses.mit;
    platforms = lib.attrNames sha256;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    mainProgram = "terminal-browser";
  };
}

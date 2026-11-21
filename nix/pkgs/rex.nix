{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
}:

let
  # Rewritten by update-rex.sh. Pinned to a release known to work with the Mac's
  # Rex app: a mismatched server can refuse the app's connections.
  version = "0.1.0-preview.22";
  channel = "preview";
  commit = "a086db17db8d464627c77e3bb0be6d462668b0ac";
  sha256 = {
    x86_64-linux = "90ef882c73d5c8fa154586ce0cc36a835a6f0b80c150eb38d3cd127b18476e3c";
    aarch64-linux = "fd8af372b6114f0b832f423fbecd9ec14a0bab0451b7a2003b2af9a497815e5c";
  };
  arch =
    {
      x86_64-linux = "amd64";
      aarch64-linux = "arm64";
    }
    .${stdenv.hostPlatform.system} or (throw "rex: no Linux release for ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation {
  pname = "rex";
  inherit version;

  src = fetchurl {
    url = "https://blob.superlogical.com/download/rex/${channel}/${commit}/rex-linux-${arch}.tar.gz";
    sha256 = sha256.${stdenv.hostPlatform.system};
  };

  sourceRoot = ".";

  # The release binary is a cgo build linked against glibc.
  nativeBuildInputs = [ autoPatchelfHook ];

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 rex $out/bin/rex
    runHook postInstall
  '';

  meta = {
    description = "Terminal multiplexer and its server (Linux release build)";
    homepage = "https://superlogical.com";
    license = lib.licenses.unfree;
    platforms = lib.attrNames sha256;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    mainProgram = "rex";
  };
}

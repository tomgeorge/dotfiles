{
  lib,
  stdenv,
  fetchFromGitHub,
  bun,
}:

let
  version = "0.10.0";

  src = fetchFromGitHub {
    owner = "modem-dev";
    repo = "hunk";
    rev = "v${version}";
    hash = "sha256-S2EuZW5vzyk3FGhUQbyanE3hdlnb9F6GQMtu2k8pjrM=";
  };

  node_modules = stdenv.mkDerivation {
    pname = "hunk-node-modules";
    inherit version src;

    nativeBuildInputs = [ bun ];

    dontConfigure = true;
    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      bun install --no-progress --frozen-lockfile --ignore-scripts
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cp -r node_modules $out
      runHook postInstall
    '';

    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = "sha256-ahajAfCjnqPT9fs7tA6FUrP2C/0gFntYEuQP8q22DQs=";
  };
in
stdenv.mkDerivation {
  pname = "hunk";
  inherit version src;

  nativeBuildInputs = [ bun ];

  dontConfigure = true;
  dontFixup = true;

  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    cp -r ${node_modules} node_modules
    chmod -R u+w node_modules
    bun build --compile src/main.tsx --outfile dist/hunk
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 dist/hunk $out/bin/hunk
    runHook postInstall
  '';

  meta = {
    description = "A review-first terminal diff viewer for agent-authored changesets";
    homepage = "https://github.com/modem-dev/hunk";
    license = lib.licenses.mit;
    mainProgram = "hunk";
  };
}

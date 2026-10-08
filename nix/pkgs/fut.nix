{
  lib,
  stdenv,
  applyPatches,
  callPackage,
  cctools,
  fetchFromGitHub,
  python3,
  runCommand,
  rustPlatform,
  stdenvNoCC,
  xcbuild,
  zig_0_16,
}:

let
  # Must match GHOSTTY_COMMIT in vendor/libghostty-vt-sys/build.rs for this fut release.
  ghostty = applyPatches {
    name = "ghostty-source";
    src = fetchFromGitHub {
      owner = "ghostty-org";
      repo = "ghostty";
      rev = "ab0b9da9e88fcb4b0533a1854e84628f663930af";
      hash = "sha256-LZuEFAt3/wfn6YWfk7NHnqLAtZ9g4mi6yTptx0mLKj0=";
    };
    # Absolute tool paths don't exist in the Darwin sandbox (mirrors nixpkgs' libghostty-vt).
    postPatch = lib.optionalString stdenv.hostPlatform.isDarwin ''
      substituteInPlace src/build/LibtoolStep.zig \
        --replace-fail /bin/cp cp \
        --replace-fail /usr/bin/ranlib ranlib
    '';
  };

  # The build script would otherwise git-clone Ghostty and let Zig fetch its
  # dependencies, neither of which works in the sandbox.
  ghosttyZigDeps = callPackage "${ghostty}/build.zig.zon.nix" {
    # Zig mis-resolves relative paths through symlinked package dirs, so copy
    # instead of symlinking (https://codeberg.org/ziglang/zig/issues/32121).
    linkFarm =
      name: entries:
      runCommand name { } ''
        mkdir -p $out
        ${lib.concatMapStringsSep "\n" (e: "cp -rL ${e.path} $out/${e.name}") entries}
      '';
  };
in
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "fut";
  version = "0.34-unstable-2026-10-08";

  # The `trunk` branch of my fork: upstream 0.34 plus my open PRs to mikker/fut.
  src = fetchFromGitHub {
    owner = "tomgeorge";
    repo = "fut";
    rev = "92af04e8148bdf27c5778812dbc3dd62b77b76a9";
    hash = "sha256-S/RyubyvkzcjCUTplWWGcls8n7vBcr1ccVLm3DJyfpw=";
  };

  cargoHash = "sha256-bGGTFllgvjITpDlOHgzUYw1e32dYrGsi9he8Ze7DsfY=";

  nativeBuildInputs = [
    zig_0_16
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [
    cctools
    # Provides xcrun, which Zig uses to locate the macOS SDK.
    xcbuild
  ];

  # Zig is only called from libghostty-vt-sys's build script; keep its setup
  # hook from replacing the cargo phases.
  dontUseZigConfigure = true;
  dontUseZigBuild = true;
  dontUseZigCheck = true;
  dontUseZigInstall = true;

  env.GHOSTTY_ZIG_SYSTEM_DIR = ghosttyZigDeps;

  preBuild = ''
    # Zig writes build artifacts next to build.zig, so it needs a writable copy.
    cp -r ${ghostty} "$TMPDIR/ghostty"
    chmod -R u+w "$TMPDIR/ghostty"
    export GHOSTTY_SOURCE_DIR="$TMPDIR/ghostty"
    export ZIG_GLOBAL_CACHE_DIR="$TMPDIR/zig-cache"
  '';

  # The test suite drives real PTYs and daemons, which the sandbox doesn't allow.
  doCheck = false;

  # The bundled extensions, kept out of the main derivation so changing them
  # doesn't rebuild fut. Each is a directory to list under `extensions`.
  passthru.extensions = stdenvNoCC.mkDerivation {
    pname = "fut-extensions";
    inherit (finalAttrs) version src;

    # wt's adapters need python3; macOS only has the Xcode CLT stub.
    buildInputs = [ python3 ];

    dontConfigure = true;
    dontBuild = true;

    installPhase = ''
      mkdir -p $out/share/fut
      cp -r extensions $out/share/fut/extensions
      rm -r $out/share/fut/extensions/*/test
      substituteInPlace $out/share/fut/extensions/wt/bin/worktree-event \
        --replace-fail 'if ! python3 -c' 'if ! ${lib.getExe python3} -c'
    '';
  };

  meta = {
    description = "Persistent, agent-aware terminal multiplexer";
    homepage = "https://fut.sh";
    # Upstream ships no license file.
    license = lib.licenses.unfree;
    mainProgram = "fut";
  };
})

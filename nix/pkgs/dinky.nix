{
  lib,
  stdenv,
  fetchFromGitHub,
  swift,
  swiftpm,
}:

let
  # Must match the TOMLDecoder pin in Package.resolved.
  tomldecoderVersion = "0.4.4";
  tomldecoder = fetchFromGitHub {
    owner = "dduan";
    repo = "TOMLDecoder";
    rev = "fa1103a62b1c08cc08eabc58dda8b55887ff1622";
    hash = "sha256-YOR8nAp89zJOk2ZkmISfdzYJm6euuNrTJmOHcfpptco=";
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "dinky";
  version = "0.21";

  # The `main` branch of my fork.
  src = fetchFromGitHub {
    owner = "tomgeorge";
    repo = "Dinky";
    rev = "38a2effdcb9d34f4e402a3f69476f39be660a878";
    hash = "sha256-USMX7PMqL25kP3w5oA2nh8FWQPH8rhNV3wr1fzAy2Mw=";
  };

  # Sparkle is a binary SwiftPM artifact SwiftPM would download at build time,
  # and self-updating an app in the Nix store can't work anyway.
  patches = [ ./dinky-no-sparkle.patch ];

  # A path dependency needs no network or resolution. SwiftPM names it after
  # its directory, so link it in under the upstream name.
  postPatch = ''
    ln -s ${tomldecoder} ../TOMLDecoder
    substituteInPlace Package.swift \
      --replace-fail '.package(url: "https://github.com/dduan/TOMLDecoder", exact: "${tomldecoderVersion}")' \
                     '.package(path: "../TOMLDecoder")'
    rm Package.resolved
  '';

  nativeBuildInputs = [
    swift
    swiftpm
  ];

  # SwiftPM's own sandbox-exec can't nest inside the Nix build.
  swiftpmFlags = [ "--disable-sandbox" ];

  # The app icon is compiled with Xcode's actool, which Nix doesn't have, so the
  # bundle goes without one; dinky only shows in the menu bar.
  installPhase = ''
    runHook preInstall

    app=$out/Applications/dinky.app
    install -Dm755 "$(swiftpmBinPath)/dinky" $app/Contents/MacOS/dinky
    install -Dm644 Resources/Info.plist $app/Contents/Info.plist
    # Drop the update feed and stamp the version, as scripts/bundle.sh does.
    sed -i \
      -e '/<key>SUFeedURL<\/key>/,+1d' \
      -e '/<key>SUPublicEDKey<\/key>/,+1d' \
      -e '/<key>CFBundleShortVersionString<\/key>/{n;s|VERSION|${finalAttrs.version}|;}' \
      -e '/<key>CFBundleVersion<\/key>/{n;s|BUILD|${finalAttrs.version}|;}' \
      $app/Contents/Info.plist

    mkdir -p $out/bin
    ln -s $app/Contents/MacOS/dinky $out/bin/dinky

    runHook postInstall
  '';

  meta = {
    description = "Tiling window manager on native macOS Spaces";
    homepage = "https://dinky.rodeo";
    license = lib.licenses.mit;
    platforms = [ "aarch64-darwin" ];
    mainProgram = "dinky";
  };
})

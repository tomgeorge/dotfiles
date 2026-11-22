{
  flake.modules.darwin.codesign =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.codesign;
      openssl = lib.getExe pkgs.openssl;
      dir = "/var/root/nix-codesign";
      keychain = "${dir}/codesign.keychain-db";
      password = "${dir}/password";
      identity = "Nix Code Signing";
    in
    {
      # Nix builds apps ad-hoc signed, so macOS identifies them by a hash of the
      # binary, and every rebuild loses their privacy grants (Accessibility,
      # Screen Recording). Signing them with a stable self-signed certificate
      # makes the designated requirement "bundle ID and this certificate", which
      # survives rebuilds.
      options.codesign.apps = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [ ];
        example = [ "dinky.app" ];
        description = "App bundles in /Applications/Nix Apps to re-sign after each activation.";
      };

      config = lib.mkIf (cfg.apps != [ ]) {
        # After nix-darwin's rsync, which restores the unsigned copies on every
        # switch. The key stays in a root-only keychain: anyone holding it could
        # sign code that inherits these apps' grants.
        system.activationScripts.postActivation.text = lib.mkAfter ''
          # In a subshell with root's HOME: sudo can keep the caller's, and
          # security(1) would add the root-only keychain to their search list.
          (
          export HOME=/var/root
          if [ ! -f ${keychain} ]; then
            echo "creating the ${identity} identity..." >&2
            install -d -m 700 ${dir}
            head -c 32 /dev/urandom | /usr/bin/xxd -p -c 64 > ${password}
            chmod 600 ${password}
            tmp=$(mktemp -d)
            ${openssl} req -x509 -newkey rsa:2048 -nodes -days 36500 \
              -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -subj "/CN=${identity}" \
              -addext "basicConstraints=critical,CA:false" \
              -addext "keyUsage=critical,digitalSignature" \
              -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null
            # macOS's importer only reads the older PKCS#12 algorithms.
            ${openssl} pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
              -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -out "$tmp/identity.p12" \
              -passout file:${password}
            /usr/bin/security create-keychain -p "$(cat ${password})" ${keychain}
            /usr/bin/security set-keychain-settings ${keychain}
            /usr/bin/security import "$tmp/identity.p12" -k ${keychain} \
              -P "$(cat ${password})" -T /usr/bin/codesign >/dev/null
            # Lets codesign use the key without a GUI prompt.
            /usr/bin/security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
              -k "$(cat ${password})" ${keychain} >/dev/null
            rm -rf "$tmp"
          fi

          echo "signing Nix apps with ${identity}..." >&2
          /usr/bin/security unlock-keychain -p "$(cat ${password})" ${keychain}
          apps=(${lib.escapeShellArgs cfg.apps})
          for app in "''${apps[@]}"; do
            /usr/bin/codesign --force --keychain ${keychain} --sign "${identity}" \
              "/Applications/Nix Apps/$app" 2>/dev/null \
              || echo "warning: couldn't sign $app" >&2
          done
          /usr/bin/security lock-keychain ${keychain}
          )
        '';
      };
    };
}

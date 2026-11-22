{
  inputs,
  config,
  lib,
  ...
}:

let
  factory = config.flake.factory;
  hm = inputs.self.modules.homeManager;
in
{
  flake.modules = lib.mkMerge [
    (factory.user {
      name = "tom";
      username = "tgeorge";
      userFullName = "Tom George";
      userEmail = "tom.george@hey.com";
      gpgKeyId = "5FA01E687B6E7C0E";
    })
    (factory.user {
      name = "tom-work";
      username = "tom.george";
      userFullName = "Tom George";
      userEmail = "thomas.george@chainguard.dev";
      gpgKeyId = "5FA01E687B6E7C0E";
    })
    # The Chainguard cloud workstations; the username comes from GCP OS Login.
    (factory.user {
      name = "tom-workstation";
      username = "thomas_george_chainguard_dev";
      userFullName = "Tom George";
      userEmail = "thomas.george@chainguard.dev";
      gpgKeyId = "5FA01E687B6E7C0E";
    })
    # No gpgKeyId: the unblok box has no key to sign with.
    (factory.user {
      name = "tom-unblok";
      username = "thomas_george_chainguard_dev";
      userFullName = "Tom George";
      userEmail = "thomas.george@chainguard.dev";
    })
    {
      homeManager.tom.imports = [
        hm.default
        hm.gpgTools
        hm.piCheckin
        # docker -> podman only on personal machines; work uses orbstack
        {
          programs.fish.shellAliases.docker = "podman";
          programs.zsh.shellAliases.docker = "podman";
          programs.bash.shellAliases.docker = "podman";
        }
      ];
      homeManager.tom-work.imports = [
        hm.default
        hm.devWork
      ];
      homeManager.tom-workstation.imports = [
        hm.headless
        hm.devWork
        hm.rex
      ];
      homeManager.tom-unblok.imports = [
        hm.base
        hm.rex
        hm.unblok
      ];
    }
  ];
}

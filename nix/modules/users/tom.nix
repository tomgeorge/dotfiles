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
    {
      homeManager.tom.imports = [
        hm.default
        hm.gpgTools
      ];
      homeManager.tom-work.imports = [ hm.default ];
    }
  ];
}

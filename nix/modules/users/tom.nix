{
  inputs,
  config,
  lib,
  ...
}:

let
  factory = config.flake.factory;
  hm = inputs.self.modules.homeManager;
  commonHmImports = with hm; [
    base
    dev
    fish
    shellTools
    terminal
  ];
in
{
  flake.modules = lib.mkMerge [
    (factory.user {
      name = "tom";
      username = "tgeorge";
      userFullName = "Tom George";
      userEmail = "tg8490@gmail.com";
      # gpgKeyId = "PERSONAL_GPG_KEY";
    })
    (factory.user {
      name = "tom-work";
      username = "tom.george";
      userFullName = "Tom George";
      userEmail = "thomas.george@chainguard.dev";
      # gpgKeyId = "WORK_GPG_KEY";
    })
    {
      homeManager.tom.imports = commonHmImports;
      homeManager.tom-work.imports = commonHmImports;
    }
  ];
}

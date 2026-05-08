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
    containers
    dev
    editing
    fish
    langs
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
      gpgKeyId = "4B8A66D31D6D2C84";
    })
    (factory.user {
      name = "tom-work";
      username = "tom.george";
      userFullName = "Tom George";
      userEmail = "thomas.george@chainguard.dev";
      gpgKeyId = "4B8A66D31D6D2C84";
    })
    {
      homeManager.tom.imports = commonHmImports;
      homeManager.tom-work.imports = commonHmImports;
    }
  ];
}

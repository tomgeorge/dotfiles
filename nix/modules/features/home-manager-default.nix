{ inputs, ... }:

{
  flake.modules = {
    # Inheritance chain: base -> default
    homeManager.default = {
      imports = with inputs.self.modules.homeManager; [
        apps
        base
        containers
        dev
        editing
        fish
        langs
        shellTools
        terminal
      ];
    };
  };
}

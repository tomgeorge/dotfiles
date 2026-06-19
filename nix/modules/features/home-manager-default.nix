{ inputs, ... }:

{
  flake.modules = {
    # Inheritance chain: base -> default
    homeManager.default = {
      imports = with inputs.self.modules.homeManager; [
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

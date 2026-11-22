{ inputs, ... }:

{
  flake.modules = {
    # Inheritance chain: base -> headless -> default
    # Everything that makes sense on a machine without a screen, such as the
    # cloud workstation.
    homeManager.headless = {
      imports = with inputs.self.modules.homeManager; [
        base
        containers
        dev
        editing
        fish
        langs
        shellTools
      ];
    };

    homeManager.default = {
      imports = with inputs.self.modules.homeManager; [
        headless
        apps
        terminal
      ];
    };
  };
}

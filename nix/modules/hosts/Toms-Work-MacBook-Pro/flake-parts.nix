{ inputs, ... }:

{
  flake.darwinConfigurations =
    inputs.self.lib.mkDarwin "aarch64-darwin" "Toms-Work-MacBook-Pro";
}

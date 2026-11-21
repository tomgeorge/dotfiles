{ inputs, ... }:

let
  inherit (inputs.self.lib) mkHome;
in
{
  # The Chainguard cloud workstations (cg work nodes). They run Chainguard OS,
  # so only the home is Nix-managed; workstation/pet-startup.sh does the rest.
  # Each configuration is named after its node, which is how the startup script
  # picks one.
  flake.homeConfigurations =
    mkHome "x86_64-linux" "work-amd64" "tom-workstation" // mkHome "x86_64-linux" "unblok" "tom-unblok";
}

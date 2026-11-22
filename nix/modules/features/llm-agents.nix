let
  # Numtide's cache for the llm-agents input (flake.nix). Without it the agent
  # CLIs build from source.
  cache = {
    nix.settings = {
      extra-substituters = [ "https://cache.numtide.com" ];
      extra-trusted-public-keys = [ "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g=" ];
    };
  };
in
{
  flake.modules = {
    darwin.llm-agents-cache = cache;
    nixos.llm-agents-cache = cache;
  };
}

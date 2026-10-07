{
  lib,
  buildGoModule,
  fetchFromGitHub,
  bashInteractive,
  git,
}:

buildGoModule (finalAttrs: {
  pname = "wt";
  version = "0.8";

  src = fetchFromGitHub {
    owner = "mikker";
    repo = "wt";
    tag = finalAttrs.version;
    hash = "sha256-SKY3xtOYMHtdtymtUHH0EhsbCagptlM9QO3JtgvJl1Q=";
  };

  vendorHash = "sha256-FDYXTmrEQ/7IX1KCLZ4yrLPvml2Ed3M3N8jotnJJRuQ=";

  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X main.version=${finalAttrs.version}"
  ];

  # The tests create real repositories and worktrees, and source the bash
  # shim, which needs `complete` (missing from stdenv's non-interactive bash).
  nativeCheckInputs = [
    bashInteractive
    git
  ];

  # No completion files: `wt shellenv zsh|bash` emits the cd shim and
  # completion together, and there is no fish variant.

  meta = {
    description = "Ephemeral Git worktree manager";
    homepage = "https://wt.fut.sh";
    # Upstream ships no license file.
    license = lib.licenses.unfree;
    mainProgram = "wt";
  };
})

{
  lib,
  stdenv,
  buildGoModule,
  fetchFromGitHub,
  installShellFiles,
}:

buildGoModule (finalAttrs: {
  pname = "inc";
  version = "0.4.18";

  src = fetchFromGitHub {
    owner = "incident-io";
    repo = "inc";
    rev = "v${finalAttrs.version}";
    hash = "sha256-MKiCXtfKxk7blDhczEPNOfmjnBPYCdziCODByu/IoR4=";
  };

  vendorHash = "sha256-fDAyyyVNbNsZOFs63bpFAsKSuVk+1eAMz2Gg35rLpG4=";

  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X github.com/incident-io/inc/cmd.version=${finalAttrs.version}"
  ];

  nativeBuildInputs = [ installShellFiles ];

  postInstall = lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    installShellCompletion --cmd inc \
      --bash <($out/bin/inc completion bash) \
      --fish <($out/bin/inc completion fish) \
      --zsh <($out/bin/inc completion zsh)
  '';

  meta = {
    description = "The incident.io command-line interface";
    homepage = "https://github.com/incident-io/inc";
    license = lib.licenses.mit;
    mainProgram = "inc";
  };
})

{
  flake.modules = {
    darwin.work-apps = {
      homebrew.brews = [
        "chainctl"
      ];
      homebrew.casks = [
        "linear-linear"
      ];
    };
  };
}

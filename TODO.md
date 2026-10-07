# TODO

## Make fish the macOS login shell

`users.users.<name>.shell = pkgs.fish` in `nix/modules/features/fish.nix` does
nothing on macOS: nix-darwin only applies it to users listed in
`users.knownUsers` with a `uid` set, and its docs say not to put the admin user
there. So `dscl . -read ~ UserShell` is still `/bin/zsh`, and `$SHELL` is zsh
even inside fish. Fut sidesteps this with `terminal.shell` in
`fut/config.toml`.

Options:

1. Run `chsh -s /run/current-system/sw/bin/fish` once per Mac. Fish is already
   in `/etc/shells`. Simple, but not declarative.
2. Add `users.knownUsers = [ username ]` and `users.users.${username}.uid = 501`
   to the darwin user module. At nix-darwin `4cff07de` this is safer than the
   docs suggest: it never deletes `system.primaryUser` or uid ≤ 501, and skips
   a user whose uid doesn't match. Costs: hardcoded uid per host, it resets
   `PrimaryGroupID` (default 20, `staff`) on every rebuild, and it may clash
   with MDM on the work Mac.

References:

- https://github.com/LnL7/nix-darwin/issues/328
- https://github.com/nix-darwin/nix-darwin/issues/1237
- https://github.com/nix-darwin/nix-darwin/pull/1584

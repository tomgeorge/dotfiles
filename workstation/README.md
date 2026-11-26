# Cloud workstations

Two Chainguard cloud workstations (`cg work` nodes in the `chainguard-workstations`
project) run Chainguard OS with a Nix-managed home:

| Node | Kind | Size | Home config | Rex host on the Mac | For |
| --- | --- | --- | --- | --- | --- |
| `work-amd64` | pet | `standard` (8 vCPU, 32G) | `homeConfigurations.work-amd64` | `workstation` | general work, long-running agents |
| `unblok` | custom node | `standard` | `homeConfigurations.unblok` | `unblok` | unblok only: git, gh, linear-cli, pi, Rex |

Both live 120 days. A node's root disk is rebuilt on every start; only `/home`
survives.

## What runs at boot

GCE runs [`pet-startup.sh`](pet-startup.sh) as root on every boot, from the
instance's `startup-script` metadata. It rebuilds what the root disk loses:

1. It waits for `/home` and for OS Login, then copies the OS Login user into
   `/etc/passwd`, because Nix-built programs can't use OS Login's NSS module.
2. It bind-mounts the Nix store from `/home/.nix` at `/nix`, installing Nix
   the first time, and restores the daemon, build users, and `nix.conf`.
3. On a fresh home disk, it activates the home-manager configuration named
   after the node (`<account>-cgw-<node>` → `#<node>`), from
   `~/git/dotfiles/nix` when that clone exists, or else from GitHub.
4. It runs Rex as the system service `rex.service`, with sockets in `/run/rex`,
   so Rex doesn't depend on a login session. `rex-tailscale-serve.service`
   publishes it at `https://<instance>.tailbbeaa.ts.net`, retrying until
   Tailscale is logged in.

Read its log with `sudo journalctl -u google-startup-scripts -b`.

## Common tasks

This `cg` build still defaults to the legacy interface, so set `CG_WORK_UX=2`
for every command below.

**Recreate a node.** This picks up the newest image and reruns the script:

```sh
cg work stop work-amd64 && cg work start work-amd64
cg work stop unblok && cg work cstart unblok --size=standard --lifetime=0 \
  --home=attach:thomas-george-cgw-unblok-home --script ~/git/dotfiles/workstation/pet-startup.sh
```

The pet's size, lifetime, and script come from `[pets]` in
`~/.config/cgw/config.toml`.

**Change a home configuration.** Edit the modules under `nix/modules/`, pull on
the node, then run on the node:

```sh
home-manager switch --flake ~/git/dotfiles/nix#$(hostname | sed 's/.*-cgw-//')
```

The script activates home-manager only on a fresh home disk, so a recreate
doesn't apply config changes.

**Bump Rex.** Run `nix/pkgs/update-rex.sh` (preview channel by default), then
switch both nodes. A server that doesn't match the Mac app's version can refuse
the app's connections. After bumping, check from the Mac:

```sh
rex --timeout 30s hosts check
rex -S workstation new check && rex -S workstation kill check
```

**Restart unblok.** A Rex server restart restores sessions as plain shells
without rerunning their commands. After a restart or a recreate, open the
`unblok` tab on the `unblok` host and run `exec unblok run`.

## First-time steps that need you

- **Tailscale sign-in.** A node with a new name needs one sign-in. `cg work`
  prints the URL. Tailscale state is kept in `/home/.state/<instance>`, so a
  recreate of the same node needs no new sign-in.
- **Logins on `unblok`.** Run `gh auth login`, `claude`, and `pi` (then `/login`) once. Git's
  credential helper comes from the home config, so skip `gh auth setup-git`,
  which fails because home-manager owns `~/.config/git/config`.

## Gotchas

- Shells started by Rex have no logind session, so they have no
  `XDG_RUNTIME_DIR` and no user systemd. Rootless Podman may not work there.
- On the Mac, macOS caches a failed lookup of a new node's MagicDNS name for a
  few minutes. If `rex -S` says "no such host" right after a sign-in, wait a
  couple of minutes before you query again.
- `~/.ssh/config` doesn't include `~/.ssh/config.d/cgw.conf`. Either add
  `Include ~/.ssh/config.d/cgw.conf`, or use `ssh` over Tailscale:
  `ssh thomas_george_chainguard_dev@thomas-george-cgw-<node>.tailbbeaa.ts.net`.

# Manage the Chainguard workstation with Nix and home-manager

## Purpose

Today the Chainguard cloud workstation is set up by hand, and every recreate of
its VM silently undoes part of that setup. On 2026-11-20 a recreate deleted the
Rex binary and the linger setting, so the Rex app on the Mac could not open
sessions on the workstation until both were fixed by hand.

After this change:

- The workstation is the new-style `cg work` pet `work-amd64`, which can live
  for 120 days instead of 12 hours.
- Its user environment comes from this repo's flake as
  `homeConfigurations.workstation`. That covers the shell, dev tools, and a
  pinned Rex binary known to work with the Mac.
- A startup script in this repo runs as root on every boot. It rebuilds the
  root-level pieces that a fresh root disk loses:
  - the Nix store mount and daemon;
  - a Rex system service;
  - a retrying `tailscale serve` unit.

To see it working:

1. Recreate the VM with `cg work stop work-amd64 && cg work start work-amd64`.
2. Without touching the VM, open a session on it from the Mac with
   `rex --timeout 30s -S workstation new check`. It succeeds.
3. Close every SSH session and try again. It still works.

## Context

**The workstation.** A Google Compute Engine VM in project
`chainguard-workstations`, created with the `cg` CLI from the Chainguard mono
repo (`~/go/bin/cg`, source in `~/git/mono/cg/pkg/commands/cgw/`, docs in
`~/git/mono/cg/pkg/commands/cgw/README.md`). It runs Chainguard OS (apk-based,
glibc, systemd, `VERSION_ID=20230214`) and has no Nix. Its login user comes from
GCP OS Login: `thomas_george_chainguard_dev`, uid `1064260596`, home
`/home/thomas_george_chainguard_dev`.

**Two disks.** The root disk is rebuilt from the newest image on every start, so
anything outside `/home` is lost: `/usr/local/bin`, `/etc` (including
`/etc/passwd` and `/etc/group`), `/var/lib`, and so on. The home disk, mounted at
`/home`, survives. The image already relies on this: tailscaled keeps its state
in `/home/.state/<vm-name>/` (root-owned), so a rebuilt VM rejoins the tailnet
without a new sign-in. That directory is named after the VM, though, so a VM
with a new name needs one Okta sign-in.

**Two `cg work` interfaces.**
- The legacy one (`CG_WORK_UX=1`, `cg work create`) names the VM
  `thomas-george-work-v2` and its home disk `thomas-george-work-v2-disk-amd64`
  (500G, us-central1-a). The current VM was made this way.
- The new one has been the default since 2026-11-01. It manages "pets", which
  are long-lived VMs named `work-amd64` and `work-arm64` (in GCP,
  `thomas-george-cgw-work-amd64`), and "custom nodes", which are throwaway VMs
  made with `cg work cstart`. It reads `~/.config/cgw/config.toml` on the Mac.

In the new interface:
- `[pets] lifetime = "0"` means the 120-day maximum.
- `script = "<path>"`, or `--script`, puts the file into the `startup-script`
  instance metadata. GCE's `google-startup-scripts.service` runs it as root on
  every boot.
- `cstart --home=<size> --home-persist` keeps a custom node's home disk after
  the node is gone, and `--home=attach:<disk>` reattaches it. `--tailscale` puts
  a custom node on the tailnet.
- The first `cg work start work-amd64` offers to clone the legacy home disk
  through a snapshot, leaving the legacy disk untouched. It reuses any snapshot
  younger than a day, so a clone can miss recent work unless the snapshot is
  taken fresh.
- The two interfaces share no state, so the legacy VM must be stopped with
  `CG_WORK_UX=1 cg work stop`.

**Rex.** Rex is the terminal multiplexer used on the Mac (an app plus the `rex`
CLI). The Mac's Rex server can connect to a Rex server on the workstation, which
the Mac lists as the host `workstation` (`rex hosts`). The route is Tailscale
Serve: tailscaled on the workstation terminates HTTPS for
`https://<vm>.tailbbeaa.ts.net` and proxies it to a Unix socket that
`rex server run --extra-listen tailnet-serve://<path>` listens on.

Rex releases are listed as JSON at
`https://blob.superlogical.com/api/releases/rex/<channel>`, with a `downloadUrl`
and `sha256` for `rex-linux-amd64.tar.gz`. Only the newest release of a channel
is known to be listed there. On 2026-11-20 the preview channel's newest was
`0.1.0-preview.22`, which works with the Mac's `0.1.0-preview.21`.
`nixpkgs#rex` is an unrelated Perl tool.

Currently, Rex runs on the workstation as a *user* service. It comes from
`~/.config/systemd/user/rex.service`, `rex.socket`, and a drop-in
`~/.config/systemd/user/rex.service.d/tailnet.conf`, all set up on 2026-11-17.
A user service runs only while the user has a login session, unless "linger" is
enabled. Linger is enabled now, but the setting lives on the root disk.

**This repo's flake.** `nix/flake.nix` uses flake-parts with `import-tree`, so
every file under `nix/modules/` is a flake-parts module. Modules publish
reusable pieces under `flake.modules.<class>.<name>`, where the class is
`darwin`, `nixos`, or `homeManager`.
- Each user is defined once in `nix/modules/users/tom.nix`, through the factory
  in `nix/modules/factory/user.nix`.
- `homeManager.tom-work` imports `hm.default` and `hm.devWork`.
- Hosts live in `nix/modules/hosts/<name>/`.
- `nix/modules/flake-parts/lib.nix` has `mkDarwin` and `mkNixos` helpers.
- The flake has no `homeConfigurations` output yet.
- Local packages live in `nix/pkgs/*.nix` and are imported with
  `pkgs.callPackage`, as `fut.nix` is in `nix/modules/features/dev.nix`.

The repo is public at `github.com/tomgeorge/dotfiles` (branch `master`), so a
VM can fetch it without credentials.

**Working tree.** Baseline at the start, from `git status --short`:

- Modified: `nix/flake.lock`, `nix/flake.nix`, `nix/modules/features/dev.nix`,
  `pi/extensions/vi-mode/{README.md,editor.test.ts,editor.ts}`, `pi/settings.json`.
- Untracked: `agents/skills/arts-artifact/`, `agents/skills/arts-report/`.

These edits are unrelated. Don't revert or commit them. This work makes no
commits unless asked. It does need its flake changes pushed before a VM can
fetch them, so ask the user before pushing, or deliver the changes with `rsync`
for testing.

## Plan of work

The work runs in this order:
1. Prove everything on a throwaway custom node.
2. Package it.
3. Migrate the real workstation.

The current VM and its disk stay untouched until the new pet passes Validation.

### Milestone 1: Prove Nix with the store on a persistent disk

Goal: show that Nix can live in `/home/.nix`, bind-mounted at `/nix`, and keep
working after a root-disk rebuild on Chainguard OS. This is the riskiest
assumption.

Work:
- Start a proof node: `cg work cstart nixproof --size=small --lifetime=6h
  --home=50 --home-persist`, then `ssh nixproof`. It isn't on the tailnet;
  ssh goes through IAP.
- As root:
  1. Confirm `/home` is a mount point and not the root filesystem. The script
     must refuse to continue otherwise, so it never fills the throwaway root
     disk.
  2. Create a root-owned `/home/.nix`, bind-mount it to `/nix`, and install Nix
     in multi-user (daemon) mode with the official installer.
- Record everything the installer wrote outside `/nix`:
  - units in `/etc/systemd/system`;
  - `/etc/nix/nix.conf`;
  - `/etc/profile.d` and other shell hooks;
  - the `nixbld` users and group;
  - root's profile and channels.
- Recreate: `cg work stop nixproof`, then `cg work cstart nixproof
  --home=attach:<disk>`. Write a reattach procedure by hand and test it:
  - mount;
  - restore the units, `nix.conf`, and shell hooks;
  - build-user identities. Try both recreating the `nixbld` group and users
    with fixed IDs, and `auto-allocate-uids`, and keep whichever works. Record
    why.
- Check GC roots and profiles: `nix-store --gc --print-roots` still lists the
  user's profile after the recreate.

Proof:
- After the recreate and reattach, `nix run nixpkgs#hello` prints
  `Hello, world!`.
- `nix-collect-garbage` doesn't delete the user's profile.

### Milestone 2: Package Rex and add `homeConfigurations.workstation`

Goal: `home-manager switch --flake <dotfiles>/nix#workstation` on the proof node
installs the user environment, including Rex.

Work, in this repo:
- Add `nix/pkgs/rex.nix`, a `stdenvNoCC` derivation that unpacks the pinned
  `rex-linux-amd64.tar.gz` into `$out/bin/rex`. Fetch it with `fetchurl`, using
  the `sha256` from the release JSON. Start with `0.1.0-preview.22`, which is
  known to work with the Mac. Check whether the Go binary is static. If it's
  dynamic, add `autoPatchelfHook`.
- Add `nix/pkgs/update-rex.sh`, modeled on `update-fut.sh`. It reads a channel's
  newest release and rewrites the version, URL, and hash. Pinning to the Mac's
  exact version is a goal only if the release API turns out to list old
  releases.
- Add a `flake.homeConfigurations` option, like
  `nix/modules/flake-parts/darwinConfigurations.nix`, and a `mkHome` helper in
  `lib.nix`.
- Add a user `tom-workstation` in `nix/modules/users/tom.nix`, with username
  `thomas_george_chainguard_dev`, importing `hm.default`, `hm.devWork`, and a
  new `hm.rex` module.
- The `hm.rex` module installs the package and sets the session variable
  `REX_SERVER`, if Milestone 3 shows it's needed.
- Add `nix/modules/hosts/workstation/flake-parts.nix` to publish
  `homeConfigurations.workstation`, using `x86_64-linux` and nixpkgs with
  `allowUnfree`.
- Fix any modules that assume Darwin or NixOS until the config evaluates and
  builds on Linux.

Proof:
- On the Mac, `nix eval ./nix#homeConfigurations.workstation.activationPackage.drvPath`
  prints a `.drv` path.
- On the proof node, `home-manager switch` succeeds and
  `~/.nix-profile/bin/rex version` prints the pinned version.

### Milestone 3: Startup script, Rex system service, and Tailscale Serve

Goal: one script, run as root on every boot, takes a fresh root disk to a
working Rex with no manual steps. Test it on the proof node, started with
`--tailscale --script`.

Work: add `workstation/pet-startup.sh` to this repo. It must be idempotent, and
it must log every step to the journal. The username is a variable at the top. In
order, it:

1. Refuses to run unless `/home` is mounted. Bind-mounts `/home/.nix` on
   `/nix`. If the store is missing, it does the first-time install from
   Milestone 1.
2. Restores build users, units, and `nix.conf`, as proven in Milestone 1. Starts
   `nix-daemon`.
3. Activates home-manager *before* Rex starts:
   - If the user's home-manager profile is missing, it runs, as the user,
     `nix run home-manager -- switch --flake <src>#workstation`. `<src>` is
     `~/git/dotfiles/nix` if that clone exists, or else
     `github:tomgeorge/dotfiles?dir=nix`.
   - If the profile exists, nothing is needed: it lives in `/nix` and the home
     directory, which both survive.
4. Stops and disables the old user units (`rex.service` and `rex.socket`), and
   moves them and the drop-in aside. Otherwise, the user's systemd could start
   a second server.
5. Writes `/etc/systemd/system/rex.service`, then enables and starts it. The
   unit sets:
   - `User=thomas_george_chainguard_dev`;
   - `Environment=HOME=/home/thomas_george_chainguard_dev`;
   - `WorkingDirectory=/home/thomas_george_chainguard_dev`;
   - `RequiresMountsFor=/nix /home` and `After=nix-daemon.service`;
   - `RuntimeDirectory=rex`, `RuntimeDirectoryPreserve=yes`;
   - `Type=notify`, `NotifyAccess=main`, `Restart=on-failure`, `Delegate=yes`,
     `KillMode=mixed`, copied from the stock user unit;
   - `ExecStart=<home>/.nix-profile/bin/rex server run --log-format text
     --listen unix:///run/rex/server.sock
     --extra-listen tailnet-serve:///run/rex/serve.sock
     --state-dir <home>/.local/state/rex`.

   Use the state directory the user service used, so saved sessions carry over.
6. Writes and starts `/etc/systemd/system/rex-tailscale-serve.service`. The unit
   runs after `tailscaled.service` and `rex.service`, and retries every 30s
   until `tailscale serve --bg --https=443 unix:/run/rex/serve.sock` succeeds.
   That covers the first boot, when the Okta sign-in finishes after the script
   has run.

Verify `REX_SERVER` against the installed CLI before relying on it. In an SSH
shell, `rex whoami --json` must report the endpoint `/run/rex/server.sock`, and
`--autostart` must not start a second server. If `REX_SERVER` doesn't work,
look for another way, such as a symlink at the default socket path.

Proof, on the proof node after a recreate:
- `systemctl is-active nix-daemon rex rex-tailscale-serve` prints `active`
  three times.
- From the Mac, `rex --timeout 30s -S <proof-node-dns> new check` succeeds.
- It still succeeds after every SSH session closes.

### Milestone 4: Migrate to the `work-amd64` pet

Goal: the real workstation is the pet, set up by the script, with all of the
legacy home directory.

Work:
1. In `~/.config/cgw/config.toml` on the Mac, set `[pets]`:
   `lifetime = "0"`, `size = "standard"`, and
   `script = "~/git/dotfiles/workstation/pet-startup.sh"`.
2. Ask the user to close their work on the legacy VM. Stop it with
   `CG_WORK_UX=1 cg work stop`, so its disk is detached and consistent.
3. Take a fresh snapshot of `thomas-george-work-v2-disk-amd64`, which `cg` must
   not reuse from earlier. Start the pet from that snapshot:
   `cg work start work-amd64 --home=restore:<snapshot>`.
4. Complete the one Tailscale sign-in in the browser.
5. Point the Mac's `workstation` Rex host at the pet's MagicDNS name.
6. Keep the legacy disk until Validation passes. Then ask before running
   `cg work disks delete thomas-george-work-v2-disk-amd64`.

Proof: `cg work list` shows `work-amd64` running with an expiry of about
2880h. Validation passes.

### Milestone 5: Cleanup

1. Delete the proof node and its disk.
2. Document in the script header how to bump Rex (`update-rex.sh`), how to
   rebuild the home environment, and how to test compatibility with the Mac.
3. Fill in Outcomes.

## Validation

All from the Mac, unless noted.

1. `cg work stop work-amd64 && cg work start work-amd64`, then wait for the
   startup script to finish (a few minutes). On the pet,
   `sudo journalctl -u google-startup-scripts -b` ends without errors.
2. `ssh work-amd64 'systemctl is-active nix-daemon rex rex-tailscale-serve; nix run nixpkgs#hello'`
   prints `active` three times, then `Hello, world!`.
3. `rex --timeout 30s hosts check` shows `workstation  reachable`.
4. Create, list, and kill a session:
   - `s=$(rex --timeout 30s -S workstation new check --json | jq -r .session_id)`
   - `rex -S workstation ls` lists `check`.
   - `rex -S workstation kill "$s"` exits 0.
5. Close every SSH session, wait one minute, and repeat step 4. It still works.
6. Compatibility check between the Mac and the workstation: open the Rex app,
   switch to the `workstation` host, and create a session from the UI.

## Progress

- [x] 2026-11-20 Research: cgw docs, Rex install script and release API,
  workstation OS and services, flake layout. Plan revised after advisor
  review.
- [x] 2026-11-20 M1: Nix with the store on a persistent disk, proven on
  `nixproof`. The proof node was created with `cstart --home=50 --home-persist`
  and recreated with `--home=attach:thomas-george-cgw-nixproof-home --script
  workstation/pet-startup.sh`. After the recreate, the script logged
  "bind-mounted" and "nix ready" and exited 0 within 3s. `hello` from the user
  profile and `nix run nixpkgs#hello` both worked, and `nix-collect-garbage`
  kept the profile. `workstation/pet-startup.sh` has the Nix half only, passes
  shellcheck, and is uncommitted.
  - Remaining: the Rex half (M3).
- [x] 2026-11-20 M2: Added:
  - `nix/pkgs/rex.nix`, pinned to `0.1.0-preview.22` with `autoPatchelfHook`;
  - `nix/pkgs/update-rex.sh`, which is idempotent and repairs a wrong hash;
  - `nix/modules/flake-parts/homeConfigurations.nix` and `lib.mkHome`;
  - `nix/modules/features/rex.nix` (`hm.rex`);
  - the `tom-workstation` user in `nix/modules/users/tom.nix`;
  - `nix/modules/hosts/workstation/flake-parts.nix`.

  At the user's request, `fut` moved out of `hm.dev` into a new
  `nix/modules/features/fut.nix` (`hm.fut`), imported by `tom` and `tom-work`
  but not the workstation. The Mac config still lists `fut`, checked with
  `nix eval` of the darwin home packages. The workstation activation package
  built on `nixproof`, and `rex version` printed `0.1.0-preview.22`. All
  uncommitted.
- [x] 2026-11-20 M3: Startup script, Rex system service, and Tailscale Serve
  unit. After the user's Tailscale sign-in, `rex-tailscale-serve` finished on
  its own ("Serve started").
  - From the Mac: `rex -S https://thomas-george-cgw-nixproof.tailbbeaa.ts.net`
    could create, run in, list, and kill sessions.
  - Full recreate with no SSH first: Rex was reachable from the Mac on the
    first try. A block printed `thomas_george_chainguard_dev` from Nix's `id`
    and `nix (Nix) 2.36.0`.
  - Session `probe2` survived two recreates, so Rex state on `/home`
    persists.
  - The boot log shows bind-mount, nix ready, profile present, rex active,
    and exit status 0.
  - Fresh home disk with no store: on `nixfresh`, the first boot failed
    because the installer said "$HOME is not set" (GCE gives startup scripts
    a bare environment). Fixed by passing `HOME=/root USER=root` to the
    installer. Rerunning under `env -i` then installed Nix, activated
    home-manager from `~/git/dotfiles`, and started Rex, exiting 0. Deleted
    `nixfresh`.
  - Earlier work: the script's Rex half (home-manager first-boot activation,
    retiring the user units, `rex.service`, `rex-tailscale-serve.service`).
    Running the script in place on `nixproof` exited 0.
    - `rex whoami` in an SSH login shell shows `unix:///run/rex/server.sock`.
    - Sessions survive logout (same PID, `NRestarts=0`).
    - The serve unit waits on the Tailscale login, as designed.
  - Remaining:
    - the user signs in to Tailscale for `nixproof`;
    - test from the Mac;
    - one full recreate.
- [x] 2026-11-21 M4 Migrate to the `work-amd64` pet, and add an `unblok` node
  (scope added 2026-11-21).
  - Both reruns ended with "rex: active". On `work-amd64`, the script retired
    the old `rex.service`, `rex.socket`, and drop-in that came over with the
    home.
  - `unblok` had no `.profile` or `.bashrc`, so `REX_RUNTIME_DIR` never
    reached its shells. `hm.rex` now sets `programs.bash.enable =
    lib.mkDefault true`, and both nodes' login shells report
    `unix:///run/rex/server.sock`.
  - After the user's sign-ins, `rex-tailscale-serve` finished by itself on
    both.
  - Mac Rex hosts: `workstation` now points at
    `https://thomas-george-cgw-work-amd64.tailbbeaa.ts.net`, and `unblok` was
    added at `https://thomas-george-cgw-unblok.tailbbeaa.ts.net`.
  - Validation, from the Mac with no SSH first, on both hosts: create a
    session, run a block (printed the username, `RT=/run/rex`, and
    `Hello, world!` from `nix run`), list, and kill (exit 0). On `unblok`,
    gh, git, and linear come from `~/.nix-profile`; go, claude, and nvim
    come from the image's `/usr/bin`.
  - Not re-run on the real nodes: the recreate test (Validation step 1).
    The same script passed it twice on `nixproof`.
  - Done:
    - Pet: `~/.config/cgw/config.toml` `[pets]` set to `size = "standard"`,
      `lifetime = "0"`, and `script = "~/git/dotfiles/workstation/pet-startup.sh"`.
    - Old VM: `cg work stop` failed, because its credential scrub couldn't
      SSH into the unresponsive VM. The instance was deleted instead with
      `gcloud compute instances delete ... --keep-disks=data`; the user
      approved.
    - Fresh snapshot: `thomas-george-work-v2-disk-amd64-migrate-20261121`.
    - Created `work-amd64` (`--home=restore:<snapshot>`, n4-standard-8,
      2880h) and `unblok` (`cstart --size=standard --lifetime=0 --home=100
      --home-persist --script ...`).
    - Home configs: `homeConfigurations.work-amd64` (`hm.headless` +
      `hm.devWork` + `hm.rex`) and `homeConfigurations.unblok` (`hm.base` +
      `hm.rex` + `hm.unblok`: git with no signing, gh, and linear-cli
      2.0.0). The script picks the config by node name.
    - First boots failed at home-manager, as expected: GitHub doesn't have
      these changes. Copied `nix/` and `workstation/` to `~/git/dotfiles` on
      both nodes (not a git checkout yet) and reran the script with
      `systemd-run --unit=pet-startup-manual`.
  - Remaining:
    - the script finishing on both nodes;
    - the user's two Tailscale sign-ins;
    - Rex hosts on the Mac;
    - Validation;
    - `gh auth login` and `linear` auth on `unblok`.
- [ ] Unblok on `unblok` (scope added 2026-11-21), from `feat/unblok-pi`.
  - Done:
    - Mac Rex hosts: the user removed the stale app-owned host. The app kept
      re-adding `thomas-george-work-v2.tailbbeaa.ts.net` through
      `hosts.put`, so the CLI couldn't remove it.
    - Moved the old unblok off `work-amd64`. It was installed on the old VM
      at 01:50 on 2026-11-21, from `feat/unblok-rex-remote`. Its
      `config.toml` and `~/.local/state/unblok` (follows, ledgers, posted,
      seen) were copied to `unblok`. Then unblok's `install.sh --uninstall`
      ran on `work-amd64`, its `~/.config/rex/init.lua` became
      `init.lua.unblok-moved-to-unblok-node`, and `rex config reload` left
      no unblok actions there.
    - `hm.unblok` puts `~/.local/bin` on the session PATH.
    - The Mac's `~/.config/rex/init.lua` now loads
      `.../worktrees/sandbox-of-power/feat-unblok-pi/.../rex/unblok.lua`.
    - The user logged in to gh and Claude Code on `unblok`.
      `gh auth setup-git` failed, because home-manager owns
      `~/.config/git/config` (read-only), so `hm.unblok` now sets the same
      `credential."https://github.com".helper` and gist entries itself.
    - Cloned `sandbox-of-power` at `feat/unblok-pi` (`f58b4120b`) to
      `~/git/sandbox-of-power`, ran `install.sh`, and wrote
      `~/.config/rex/init.lua` to load `~/.config/unblok/rex.lua`.
      `unblok doctor` passed everything, with one warning: the clones dir is
      created on the first review.
    - Started `rex new unblok -c ~ --window unblok -- bash -lc "exec unblok run"`.
    - Fix: `rex.service` ran with `PATH=/usr/local/bin:/usr/bin`, so
      `unblok_status` (`rex.exec` of `unblok status --json`) couldn't find
      `rex` and returned `null`. The unit now sets `PATH` to
      `~/.local/bin`, `~/.nix-profile/bin`, the Nix default profile, and
      then the system dirs. The script was rerun on both nodes.
    - From the Mac, `rex -S unblok do unblok_status --json` lists six PRs,
      two of which need the user.
    - A Rex server restart restores sessions as plain shells and does *not*
      rerun their commands. The unblok daemon had to be restarted by typing
      `exec unblok run` into the dashboard tab; it logged "daemon started
      pid=23343".
- [x] 2026-11-21 Commit `6fdc2e5` "Manage the cloud workstations with
  home-manager" (signed, not pushed). It contains only this work. The
  user's uncommitted edits stayed out: in `dev.nix`, only the `fut` hunks
  were staged, through `git update-index --cacheinfo`. The staged tree was
  checked from `git checkout-index` into `/tmp/idx`: both
  `homeConfigurations` evaluate, and the Mac config still lists ghostty-bin,
  podman-desktop, hey, and fut.
- [ ] M5 Cleanup.
  - Done: deleted the `nixproof-home` disk and its daily snapshot
    `nixproof-home-snap-20261121-040154` (`nixproof` itself expired).
    Wrote `workstation/README.md`: the nodes, what runs at boot, recreating,
    changing a home config, bumping Rex, restarting unblok, first-time
    steps, and gotchas.
  - Remaining:
    - push, then replace the plain `~/git/dotfiles` copies on both nodes
      with git clones;
    - commit the README and the plan updates;
    - the user decides on the old disk
      `thomas-george-work-v2-disk-amd64` (us-central1-a, 500G) and the
      snapshot `thomas-george-work-v2-disk-amd64-migrate-20261121`.

## Surprises & Discoveries

- 2026-11-20: Recreating the legacy VM removed `/usr/local/bin/rex` and linger,
  but kept the user unit files and Tailscale state, which are on `/home`. Rex
  then crash-looped, and the Mac saw 502 errors.
- 2026-11-20: Without linger, systemd stopped the user manager, and Rex with
  it, about 1s after each SSH session closed. The journal shows "Stopping Rex
  Personal Server" right after logout.
- 2026-11-20: Connections from the Mac failed with "reading API control welcome
  ... EOF" while Rex snapshot `0.0.1795191045-g7da303` was installed. This
  overlapped with the linger problem, so it's *not* proven that the snapshot
  was incompatible. `0.1.0-preview.22` is known to work with the Mac's
  `0.1.0-preview.21`.
- 2026-11-20: Tailscale state is in `/home/.state/<vm-name>`, keyed by VM name,
  so the rename to `thomas-george-cgw-work-amd64` needs one new sign-in.

- 2026-11-20: This `~/go/bin/cg` build still defaults to the *legacy*
  interface. The README says otherwise. Every new-style command needs
  `CG_WORK_UX=2`.
- 2026-11-20: `~/.ssh/config` doesn't include `~/.ssh/config.d/cgw.conf`, and
  the OS Login key is `~/.ssh/google_compute_engine`, not the default identity.
  Reach a node with
  `ssh -F ~/.ssh/config.d/cgw.conf -i ~/.ssh/google_compute_engine -o IdentitiesOnly=yes <node>`.
  The wrapper `/tmp/np.sh` does that for `nixproof`.
- 2026-11-20: Custom nodes join the tailnet in this `cg` build, despite the
  README. Each new node name prints an Okta login URL.
- 2026-11-20: The Nix 2.36.0 multi-user installer, run with the store
  bind-mounted, writes these outside `/nix`:
  - unit symlinks into `/nix/var/nix/profiles/default/lib/...`, for
    `nix-daemon.{service,socket}` and `tmpfiles.d/nix-daemon.conf`;
  - `/etc/nix/nix.conf`, containing only `build-users-group = nixbld`;
  - group `nixbld` (gid 30000) and users `nixbld1`–`nixbld32` (uids
    30001–30032);
  - "# Nix" hook blocks in `/etc/profile.d/nix.sh`, `/etc/bashrc`,
    `/etc/bash.bashrc`, `/etc/zsh/zshrc`, and `/etc/fish/conf.d/nix.fish`.

  Root's own profile and channels live in `/nix/var/nix/profiles/per-user/root`,
  which persists. The user's profile is under `~/.local/state/nix`.
- 2026-11-20: Startup-script output goes to the journal under
  `google-startup-scripts`, prefixed `startup-script:`. A "Cannot connect to
  cloud logging" error after it is harmless (no IAM permission).

- 2026-11-20: Nix can't evaluate `homeConfigurations.workstation` on the Mac:
  `fut.nix` imports from a derivation (Ghostty's `build.zig.zon.nix`) that
  must build on x86_64-linux. Evaluate and build on a Linux node instead.
  Copy the tree with `COPYFILE_DISABLE=1 tar --no-xattrs`, because
  AppleDouble `._*.nix` files break `import-tree`. Use `path:` flake refs, so
  untracked files are included without touching the git index.
- 2026-11-20: `fut` doesn't link on Linux: GNU ld reports ".eh_frame_hdr refers
  to overlapping FDEs" for the Zig-built libghostty objects. The user chose
  to leave `fut` off the workstation rather than fix it.
- 2026-11-20: The Rex CLI honors `REX_RUNTIME_DIR`, which sets where both the
  server and the CLI put `server.sock`, and `REX_AUTOSTART=0`. That replaces
  the planned `REX_SERVER` and `--listen`.
- 2026-11-20: `runuser -l` on Chainguard OS doesn't source `/etc/profile`
  (PATH stays `/usr/local/bin:/bin:/usr/bin`), so the script's first
  home-manager activation failed with exit 127. `as_user` now sets `HOME`,
  `PATH` (Nix's default profile first), and `NIX_SSL_CERT_FILE` with
  `env -i`.

- 2026-11-20: Nix-built programs can't resolve the OS Login user, because
  Nix's glibc can't load the image's `libnss_oslogin`. For example,
  `~/.nix-profile/bin/id` printed "cannot find name for user ID 1064260596".
  `nsswitch.conf` lists `compat` first, so the script now mirrors the user's
  passwd, group, and shadow entries into `/etc` on every boot.
- 2026-11-20: Early in boot, OS Login can't resolve the user yet. `getent`
  exited 2, and the script died silently, with exit status 2 and no log line.
  The script now waits up to 120s for OS Login and has an `ERR` trap (with
  `set -E`) that logs the failing line.
- 2026-11-20: macOS can cache a negative DNS answer for a new MagicDNS name
  that was looked up before the node signed in. `dig` resolved it while Rex,
  which uses the system resolver, got "no such host" for about a minute.

- 2026-11-21: `nixproof` hit its 6h lifetime overnight and was deleted. Its
  home disk `thomas-george-cgw-nixproof-home` remains. The gcloud
  credentials had also expired; `cg` started `gcloud auth login` itself.
- 2026-11-21: On a brand-new home disk, the user's home directory doesn't
  exist until the first login. Home-manager failed with "creating directory
  .../.cache/nix/fetcher-locks: Permission denied". That exposed a bug:
  `bash -c "cd ~ && set -e; ..."` skipped `set -e` when `cd` failed, and went
  on to run `/activate` with an empty path (exit 127). Fixed by calling
  `mkhomedir_helper` when the home is missing, and by running as `bash -euc
  "cd ~; ..."`.
- 2026-11-21: `cstart` can't set custom metadata, so the script reads the
  instance name from the metadata server and strips `<account>-cgw-` to get
  the home-manager configuration name.
- 2026-11-21: The macOS negative DNS cache struck again. Polling a new node's
  name before its Tailscale sign-in kept "no such host" cached; a 30s watch
  loop kept refreshing it for an hour. After about 2.5 minutes with no
  queries, `dscacheutil` resolved both names. Next time, wait for the
  node's `BackendState: Running` over IAP before querying its MagicDNS name
  from the Mac.
- 2026-11-21: Piping `tar` into the cgw IAP ssh alias truncated the stream
  ("gzip: unexpected end of file"), but redirecting a file into it worked.

## Decision Log

- 2026-11-21: Two nodes. The pet `work-amd64` is for long-running agents and
  general work, and takes the old home. A custom node `unblok` (persistent
  home, 120 days, `standard`, because unblok crashed on a smaller box) runs
  only unblok, with git, gh, and linear-cli. The user chose this. Only one
  pet per architecture is allowed, so `unblok` must be a custom node.
- 2026-11-21: GUI and desktop packages stay off the workstations. Added
  `hm.headless`, which is `hm.default` without `apps` (hey), `terminal`
  (ghostty), and a new `containersDesktop` (podman-desktop, split out of
  `containers`). `hm.default` = `headless` + those three, so the Mac and
  meerkat configs are unchanged. The Mac config still lists ghostty-bin,
  podman-desktop, hey, and fut.

- 2026-11-20: Recreate the `nixbld` group and users with the installer's fixed
  IDs (`groupadd`/`useradd`) on every boot. Rejected: `auto-allocate-uids`,
  which is an experimental Nix feature. Fixed IDs worked on the first try, so
  it wasn't needed. The script owns `nix.conf` and rewrites it on every boot.

- 2026-11-20: Store `/nix` on the home disk and bind-mount it at boot. A
  recreate is then quick and doesn't redownload the store. Rejected:
  reinstalling Nix on every boot, which takes minutes and depends on the
  network.
- 2026-11-20: Move to the new `cg work` interface (pet `work-amd64`). The
  legacy one is deprecated, and pets can live 120 days. User's choice.
- 2026-11-20: Run Rex as a systemd system service with `User=`, not a user
  service with linger. The user has root, and a system unit doesn't depend on
  logind. Cost: shells that Rex starts have no logind session, so they have no
  `XDG_RUNTIME_DIR` and no user systemd or D-Bus. Tools such as rootless
  Podman may need that. Revisit if that bites. User's choice.
- 2026-11-20: Let home-manager own the Rex binary and let the root startup
  script own the system units. home-manager can't write `/etc`. Rejected:
  numtide's system-manager, which would declare the system units in Nix but
  adds a flake input and a less common tool. Reconsider if the root script
  grows.
- 2026-11-20: Prove everything on a throwaway custom node (`nixproof`) before
  migrating, so the working VM isn't recreated repeatedly while we learn. From
  advisor review.
- 2026-11-20: Run `tailscale serve` from its own retrying unit, not once from
  the script, because the first boot's Okta sign-in finishes after the script
  runs.
- 2026-11-20: Migrate from a fresh snapshot taken after stopping the legacy
  VM, with `--home=restore:`, not the automatic clone offer. The clone offer may
  reuse a snapshot up to a day old.
- 2026-11-20: Pet size `standard` (n4-standard-8: 8 vCPU, 32G, about
  $0.43/hr, about $315/month running 24/7), with `lifetime = "0"`. User's
  choice, replacing the earlier `small`. Rejected: n4-standard-16 and `big`
  (cost), and `n4-highmem-8` (more memory than needed). Change `size` in
  `~/.config/cgw/config.toml`; it takes effect on the next stop and start.

## Outcomes & Retrospective

**Achieved.**
- The old hand-built VM is replaced by two nodes whose setup is in this repo:
  - `work-amd64`, the pet: n4-standard-8, 120 days, the old home restored
    from a fresh snapshot;
  - `unblok`: n4-standard-8, 120 days, a persistent 100G home, running
    unblok from `feat/unblok-pi`.
- A recreate reattaches the Nix store, restarts Rex as a system service, and
  republishes it over Tailscale Serve with no manual steps. Proven twice on
  `nixproof`. Rex works from the Mac with no SSH session open.
- The pet's home is `hm.headless`; `unblok`'s is git, gh, linear-cli, and
  Rex. The Mac's own config didn't change.

**Still manual.**
- One Tailscale sign-in per new node name.
- `gh` and Claude logins on `unblok`.
- Restarting `unblok run` after any Rex server restart. Rex restores sessions
  without rerunning their commands. A small unit that starts the unblok
  session after `rex.service` would remove this; not done.
- Home-manager changes need a `home-manager switch` on the node. The script
  activates only on a fresh disk.

**Lessons worth keeping.**
- On macOS, tar with `COPYFILE_DISABLE=1 --no-xattrs` before shipping a
  tree that `import-tree` reads; `._*.nix` files break evaluation.
- On Chainguard OS, `runuser -l` doesn't source `/etc/profile`, and GCE
  startup scripts get no `HOME`. Set the environment explicitly.
- Nix-built programs on an OS Login VM can't resolve the user without an
  `/etc/passwd` entry.
- A systemd unit's `PATH` is not a login shell's. Anything a server execs on
  the user's behalf (here, Rex's `init.lua`) needs `PATH` set in the unit.
- `set -e` doesn't apply inside `a && set -e; ...` when `a` fails. Use
  `bash -euc`.
- This `cg` build needs `CG_WORK_UX=2`, despite its README.
- For an end-to-end test, start polling a new node's MagicDNS name from the
  Mac only after the node reports `BackendState: Running`. Otherwise macOS
  caches the miss.

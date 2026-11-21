#!/bin/bash
# Boot script for the cg work pet (see .agent/plans/workstation-nix.md).
#
# GCE runs this as root on every boot, from the instance's startup-script
# metadata, which cg work sets from `script` in ~/.config/cgw/config.toml.
# Every boot starts from a fresh root disk and only /home survives, so this
# rebuilds what the root disk loses. It must stay idempotent.
#
# The Nix store lives on the home disk at /home/.nix and is bind-mounted at
# /nix, so a rebuilt VM reattaches it instead of reinstalling.

set -Eeuo pipefail

readonly NIX_HOME=/home/.nix
# The installer's defaults; reusing them keeps store ownership consistent
# across rebuilds.
readonly NIXBLD_GID=30000
readonly NIXBLD_FIRST_UID=30001
readonly NIXBLD_COUNT=32
readonly NIX_PROFILE=/nix/var/nix/profiles/default
# Where the server's sockets live. hm.rex points the CLI here too.
readonly REX_RUNTIME_DIR=/run/rex
# Used only when the home disk has no clone of the dotfiles yet.
readonly DOTFILES_FLAKE='github:tomgeorge/dotfiles?dir=nix'

log() { echo "pet-startup: $*"; }

# set -e alone exits without a word; say where.
trap 'log "failed (exit $?) at line $LINENO: $BASH_COMMAND"' ERR

# A root disk is thrown away on rebuild, so writing the store there would lose it.
wait_for_home() {
	for _ in $(seq 60); do
		mountpoint -q /home && return 0
		sleep 1
	done
	log "/home is not mounted after 60s; refusing to continue"
	exit 1
}

mount_nix() {
	install -d -m 0755 -o root -g root "$NIX_HOME" /nix
	if ! mountpoint -q /nix; then
		mount --bind "$NIX_HOME" /nix
		log "bind-mounted $NIX_HOME at /nix"
	fi
}

nix_installed() { [ -x "$NIX_PROFILE/bin/nix" ]; }

install_nix() {
	log "no Nix store on the home disk; installing"
	local installer
	installer=$(mktemp)
	curl -fsSL https://nixos.org/nix/install -o "$installer"
	# GCE runs startup scripts without HOME, which the installer requires.
	HOME=/root USER=root sh "$installer" --daemon --yes
	rm -f "$installer"
}

ensure_build_users() {
	getent group nixbld >/dev/null || groupadd --system --gid "$NIXBLD_GID" nixbld
	local i uid
	for i in $(seq "$NIXBLD_COUNT"); do
		uid=$((NIXBLD_FIRST_UID + i - 1))
		getent passwd "nixbld$i" >/dev/null && continue
		useradd --system --no-create-home --home-dir /var/empty --shell /sbin/nologin \
			--uid "$uid" --gid nixbld --groups nixbld --comment "Nix build user $i" "nixbld$i"
	done
}

write_nix_conf() {
	install -d -m 0755 /etc/nix
	cat >/etc/nix/nix.conf <<-EOF
		build-users-group = nixbld
		experimental-features = nix-command flakes
		trusted-users = root $PET_USER
	EOF
}

# The installer links these into /etc, which a rebuild loses.
link_daemon_units() {
	ln -sfn "$NIX_PROFILE/lib/systemd/system/nix-daemon.service" /etc/systemd/system/nix-daemon.service
	ln -sfn "$NIX_PROFILE/lib/systemd/system/nix-daemon.socket" /etc/systemd/system/nix-daemon.socket
	ln -sfn "$NIX_PROFILE/lib/tmpfiles.d/nix-daemon.conf" /etc/tmpfiles.d/nix-daemon.conf
}

# Appends the installer's shell hook to FILE unless it is already there.
add_shell_hook() {
	local file=$1 hook=$2
	grep -qs '# Nix' "$file" && return 0
	install -d "$(dirname "$file")"
	printf '\n# Nix\n%s\n# End Nix\n' "$hook" >>"$file"
}

write_shell_hooks() {
	local sh_hook fish_hook
	sh_hook="if [ -e '$NIX_PROFILE/etc/profile.d/nix-daemon.sh' ]; then
  . '$NIX_PROFILE/etc/profile.d/nix-daemon.sh'
fi"
	fish_hook="if test -e '$NIX_PROFILE/etc/profile.d/nix-daemon.fish'
  . '$NIX_PROFILE/etc/profile.d/nix-daemon.fish'
end"
	local f
	for f in /etc/profile.d/nix.sh /etc/bashrc /etc/bash.bashrc /etc/zsh/zshrc; do
		add_shell_hook "$f" "$sh_hook"
	done
	add_shell_hook /etc/fish/conf.d/nix.fish "$fish_hook"
}

start_nix_daemon() {
	systemctl daemon-reload
	systemd-tmpfiles --create /etc/tmpfiles.d/nix-daemon.conf
	systemctl enable nix-daemon.socket
	systemctl restart nix-daemon.socket nix-daemon.service
}

setup_nix() {
	mount_nix
	if nix_installed; then
		ensure_build_users
		link_daemon_units
		write_shell_hooks
	else
		install_nix
	fi
	write_nix_conf
	start_nix_daemon
	log "nix ready: $("$NIX_PROFILE/bin/nix" --version)"
}

# The pet user comes from OS Login, which glibc resolves through the image's
# libnss_oslogin. Nix-built programs carry their own glibc, which can't load
# that module, so `id`, ssh and friends from the home-manager profile can't
# name the user. They can read /etc/passwd, so copy the OS Login entries there.
mirror_oslogin_user() {
	local pw gr
	pw=$(getent passwd "$PET_USER")
	gr=$(getent group "$(echo "$pw" | cut -d: -f4)")
	grep -q "^$PET_USER:" /etc/passwd || echo "$pw" >>/etc/passwd
	grep -q "^${gr%%:*}:" /etc/group || echo "$gr" >>/etc/group
	grep -q "^$PET_USER:" /etc/shadow || echo "$PET_USER:*:::::::" >>/etc/shadow
}

# Runs a shell command as the pet user with Nix on PATH. `runuser -l` on
# Chainguard OS doesn't source /etc/profile, so set the environment here.
as_user() {
	local home
	home=$(getent passwd "$PET_USER" | cut -d: -f6)
	runuser -u "$PET_USER" -- env -i HOME="$home" USER="$PET_USER" \
		PATH="$NIX_PROFILE/bin:/usr/bin:/bin" \
		NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
		bash -euc "cd ~; $1"
}

# The home-manager profile lives in /home and /nix, so it survives a rebuild;
# only the first boot on a fresh home disk needs to build and activate it.
# cg work names instances <account>-cgw-<node>, and the flake names each
# home-manager configuration after its node.
node_name() {
	local instance
	instance=$(curl -fsS -H Metadata-Flavor:Google \
		http://metadata.google.internal/computeMetadata/v1/instance/name)
	echo "${instance#*-cgw-}"
}

setup_home_manager() {
	local home flake node
	home=$(getent passwd "$PET_USER" | cut -d: -f6)
	if [ -e "$home/.local/state/nix/profiles/home-manager" ]; then
		log "home-manager profile present"
		return 0
	fi
	flake=$DOTFILES_FLAKE
	[ -f "$home/git/dotfiles/nix/flake.nix" ] && flake="path:$home/git/dotfiles/nix"
	node=$(node_name)
	log "activating home-manager configuration $node from $flake"
	as_user "out=\$(nix build --no-link --print-out-paths '$flake#homeConfigurations.$node.activationPackage'); HOME_MANAGER_BACKUP_EXT=backup \$out/activate"
}

# Before 2026-11-20 Rex ran as a user service, which needs linger. Move those
# units aside so the user manager can't start a second server.
retire_user_rex_units() {
	local dir aside
	dir="$(getent passwd "$PET_USER" | cut -d: -f6)/.config/systemd/user"
	aside="$dir/retired-by-pet-startup"
	local f
	for f in rex.service rex.socket rex.service.d default.target.wants/rex.service sockets.target.wants/rex.socket; do
		[ -e "$dir/$f" ] || [ -L "$dir/$f" ] || continue
		install -d -o "$PET_USER" "$aside"
		mv "$dir/$f" "$aside/$(echo "$f" | tr / _)"
		log "retired user unit $f"
	done
}

write_rex_units() {
	local home
	home=$(getent passwd "$PET_USER" | cut -d: -f6)
	# Type, Delegate and friends follow the stock user unit that rex server
	# install writes.
	cat >/etc/systemd/system/rex.service <<-EOF
		[Unit]
		Description=Rex server for $PET_USER
		RequiresMountsFor=/nix /home
		After=network-online.target nix-daemon.socket
		Wants=network-online.target

		[Service]
		Type=notify
		NotifyAccess=main
		User=$PET_USER
		WorkingDirectory=$home
		Environment=HOME=$home
		# Programs the server runs itself, such as rex.exec in init.lua, get this
		# PATH rather than a login shell's.
		Environment=PATH=$home/.local/bin:$home/.nix-profile/bin:$NIX_PROFILE/bin:/usr/local/bin:/usr/bin:/bin
		Environment=REX_RUNTIME_DIR=$REX_RUNTIME_DIR
		Environment=REX_AUTOSTART=0
		Environment=REX_CGROUP_DELEGATED=1
		RuntimeDirectory=rex
		RuntimeDirectoryPreserve=yes
		ExecStart=$home/.nix-profile/bin/rex server run --log-format text --state-dir $home/.local/state/rex --extra-listen tailnet-serve://$REX_RUNTIME_DIR/serve.sock
		Restart=on-failure
		RestartSec=5s
		KillMode=mixed
		Delegate=yes
		DelegateSubgroup=server

		[Install]
		WantedBy=multi-user.target
	EOF

	# tailscaled keeps the serve config, but a new VM name means new tailscaled
	# state, and on first boot the Okta sign-in finishes after this script ends.
	# So keep trying until it takes.
	cat >/etc/systemd/system/rex-tailscale-serve.service <<-EOF
		[Unit]
		Description=Serve Rex on this node's tailnet HTTPS name
		After=tailscaled.service rex.service
		Wants=tailscaled.service rex.service

		[Service]
		Type=oneshot
		RemainAfterExit=yes
		TimeoutStartSec=infinity
		ExecStart=/bin/sh -c 'until tailscale serve --bg --https=443 unix:$REX_RUNTIME_DIR/serve.sock; do sleep 30; done'

		[Install]
		WantedBy=multi-user.target
	EOF
}

setup_rex() {
	setup_home_manager
	retire_user_rex_units
	write_rex_units
	systemctl daemon-reload
	systemctl enable rex.service rex-tailscale-serve.service
	systemctl restart rex.service
	# --no-block: on first boot this waits for the Tailscale sign-in.
	systemctl start --no-block rex-tailscale-serve.service
	log "rex: $(systemctl is-active rex.service)"
}

# OS Login answers only once the guest agent is up, which can be after this
# script starts.
wait_for_oslogin() {
	for _ in $(seq 120); do
		getent passwd "$PET_USER" >/dev/null && return 0
		sleep 1
	done
	log "OS Login can't resolve $PET_USER after 120s; refusing to continue"
	exit 1
}

main() {
	PET_USER=${PET_USER:-thomas_george_chainguard_dev}
	readonly PET_USER
	wait_for_home
	wait_for_oslogin
	mirror_oslogin_user
	# A new home disk has no home directory until the first login makes one.
	[ -d "$(getent passwd "$PET_USER" | cut -d: -f6)" ] || mkhomedir_helper "$PET_USER"
	setup_nix
	setup_rex
}

main "$@"

#!/usr/bin/env bash
# Point rex.nix at the newest release on a Rex channel (default: preview).
#
# Rex's release API lists only each channel's newest release, so this can't
# pin an older one. After bumping, check that the Mac's Rex app still connects
# to the workstation (see .agent/plans/workstation-nix.md, Validation).
#
# Usage: nix/pkgs/update-rex.sh [channel]
set -Eeuo pipefail

channel=${1:-preview}

here=$(cd "$(dirname "$0")" && pwd)
pkg="$here/rex.nix"

for tool in curl jq sed; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

release=$(curl -fsSL "https://blob.superlogical.com/api/releases/rex/$channel")
version=$(jq -r .version <<<"$release")
commit=$(jq -r .commit <<<"$release")
hash_for() {
  # Exact name: the channel also lists -musl builds and .zip archives.
  jq -r --arg name "rex-linux-$1.tar.gz" '.artifacts[] | select(.filename == $name) | .sha256' \
    <<<"$release"
}
amd64=$(hash_for amd64)
arm64=$(hash_for arm64)
for v in "$version" "$commit" "$amd64" "$arm64"; do
  [ -n "$v" ] && [ "$v" != null ] || { echo "error: incomplete release JSON for $channel" >&2; exit 1; }
done

sed -i.bak \
  -e "s|^  version = \".*\";|  version = \"$version\";|" \
  -e "s|^  channel = \".*\";|  channel = \"$channel\";|" \
  -e "s|^  commit = \".*\";|  commit = \"$commit\";|" \
  -e "s|^    x86_64-linux = \"[0-9a-f]*\";|    x86_64-linux = \"$amd64\";|" \
  -e "s|^    aarch64-linux = \"[0-9a-f]*\";|    aarch64-linux = \"$arm64\";|" \
  "$pkg"
rm -f "$pkg.bak"
echo "rex.nix now at $version ($channel, ${commit:0:7})"

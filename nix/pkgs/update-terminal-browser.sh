#!/usr/bin/env bash
# Point terminal-browser.nix at the release upstream's installer currently
# serves. The installer embeds the version and each platform's sha256.
#
# Usage: nix/pkgs/update-terminal-browser.sh
set -Eeuo pipefail

here=$(cd "$(dirname "$0")" && pwd)
pkg="$here/terminal-browser.nix"

for tool in curl awk sed; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

installer=$(curl -fsSL https://terminal-browser.sh/install)
field() { sed -n "s/^$1=\"\(.*\)\"$/\1/p" <<<"$installer"; }
hash_for() { awk -v t="$1" '$1 == t || $1 == "PLATFORMS=\"" t { print $3 }' <<<"$installer"; }

version=$(field VERSION)
version=${version#v}
channel=$(field CHANNEL)
arm64=$(hash_for darwin-arm64)
x64=$(hash_for darwin-x64)
for v in "$version" "$channel" "$arm64" "$x64"; do
  [ -n "$v" ] || { echo "error: couldn't parse the installer" >&2; exit 1; }
done

sed -i.bak \
  -e "s|^  version = \".*\";|  version = \"$version\";|" \
  -e "s|^  channel = \".*\";|  channel = \"$channel\";|" \
  -e "s|^    aarch64-darwin = \"[0-9a-f]*\";|    aarch64-darwin = \"$arm64\";|" \
  -e "s|^    x86_64-darwin = \"[0-9a-f]*\";|    x86_64-darwin = \"$x64\";|" \
  "$pkg"
rm -f "$pkg.bak"
echo "terminal-browser.nix now at $version ($channel)"

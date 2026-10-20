#!/usr/bin/env bash
# Point dinky.nix at the latest commit of a branch on my fork (default: main),
# refresh its hashes and the TOMLDecoder pin, and build it to prove the result
# (including that dinky-no-sparkle.patch still applies).
#
# Usage: nix/pkgs/update-dinky.sh [branch]
set -Eeuo pipefail

owner=tomgeorge
repo=Dinky
branch=${1:-main}

here=$(cd "$(dirname "$0")" && pwd)
pkg="$here/dinky.nix"
flake_dir=$(cd "$here/.." && pwd) # nix/, whose flake.lock pins the nixpkgs we deploy with

for tool in git nix jq; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

remote="https://github.com/$owner/$repo"
rev=$(git ls-remote "$remote" "refs/heads/$branch" | cut -f1)
[ -n "$rev" ] || { echo "error: branch $branch not found on $owner/$repo" >&2; exit 1; }

current=$(sed -n '/^  src = fetchFromGitHub/,/};/s/^    rev = "\([0-9a-f]\{40\}\)";/\1/p' "$pkg")
if [ "$rev" = "$current" ]; then
  echo "dinky.nix already at $owner/$repo@$branch (${rev:0:7})"
  exit 0
fi
echo "updating ${current:0:7} -> ${rev:0:7} ($owner/$repo@$branch)"

prefetch=$(nix flake prefetch --json "github:$owner/$repo/$rev")
src_hash=$(jq -r .hash <<<"$prefetch")
store_path=$(jq -r .storePath <<<"$prefetch")
last_modified=$(jq -r .locked.lastModified <<<"$prefetch")

# A release commit gets the plain version; anything else is the last release
# in the changelog plus the commit date.
tag=$(git ls-remote --tags "$remote" | awk -v rev="$rev" '$1 == rev { sub(/^refs\/tags\/v?/, "", $2); sub(/\^\{\}$/, "", $2); print $2; exit }')
if [ -n "$tag" ]; then
  version=$tag
else
  base=$(sed -n 's/^## \([0-9][0-9.]*\)$/\1/p' "$store_path/CHANGELOG.md" | head -n1)
  [ -n "$base" ] || { echo "error: no release heading in CHANGELOG.md" >&2; exit 1; }
  date=$(date -u -r "$last_modified" +%F 2>/dev/null || date -u -d "@$last_modified" +%F)
  version="$base-unstable-$date"
fi

pin() { jq -r --arg id tomldecoder ".pins[] | select(.identity == \$id) | .state.$1" "$store_path/Package.resolved"; }
toml_version=$(pin version)
toml_rev=$(pin revision)
[ -n "$toml_rev" ] && [ "$toml_rev" != null ] || { echo "error: TOMLDecoder pin not found in Package.resolved" >&2; exit 1; }
toml_hash=$(sed -n '/tomldecoder = fetchFromGitHub/,/};/s/^    hash = "\(.*\)";/\1/p' "$pkg")
if ! grep -q "^    rev = \"$toml_rev\";" "$pkg"; then
  echo "TOMLDecoder pin changed -> $toml_version (${toml_rev:0:7})"
  toml_hash=$(nix flake prefetch --json "github:dduan/TOMLDecoder/$toml_rev" | jq -r .hash)
fi

if ! jq -e '.pins | map(.identity) - ["tomldecoder", "sparkle"] | length == 0' "$store_path/Package.resolved" >/dev/null; then
  echo "error: new SwiftPM dependencies; dinky.nix only vendors TOMLDecoder" >&2
  exit 1
fi

backup=$(mktemp)
cp "$pkg" "$backup"
restore() { cp "$backup" "$pkg"; echo "error: restored the original dinky.nix" >&2; }
trap 'rm -f "$backup"' EXIT
trap 'restore' ERR

# Rewrite via a temp file: `sed -i` differs between macOS and Linux.
tmp=$(mktemp)
sed \
  -e "s|^\(  version = \)\".*\";|\1\"$version\";|" \
  -e "s|^\(  tomldecoderVersion = \)\".*\";|\1\"$toml_version\";|" \
  -e "/^  src = fetchFromGitHub/,/};/{s|^\(    rev = \)\".*\";|\1\"$rev\";|;s|^\(    hash = \)\".*\";|\1\"$src_hash\";|;}" \
  -e "/tomldecoder = fetchFromGitHub/,/};/{s|^\(    rev = \)\".*\";|\1\"$toml_rev\";|;s|^\(    hash = \)\".*\";|\1\"$toml_hash\";|;}" \
  "$pkg" >"$tmp"
mv "$tmp" "$pkg"

# Build from the working tree (not the flake's git snapshot) so the edits
# count, with the nixpkgs the system config uses.
echo "building dinky $version..."
nix build --no-link --print-out-paths --impure --expr "
  let
    flake = builtins.getFlake \"path:$flake_dir\";
    pkgs = import flake.inputs.nixpkgs { system = builtins.currentSystem; };
  in pkgs.callPackage $pkg { }"
trap - ERR

echo "dinky.nix -> $version (${rev:0:7}); review with: git diff ${pkg#"$PWD/"}"

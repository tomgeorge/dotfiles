#!/usr/bin/env bash
# Point fut.nix at the latest commit of a branch on my fork (default: trunk),
# refresh its hashes, and build it to prove the result.
#
# Usage: nix/pkgs/update-fut.sh [branch]
set -Eeuo pipefail

owner=tomgeorge
repo=fut
branch=${1:-trunk}

here=$(cd "$(dirname "$0")" && pwd)
pkg="$here/fut.nix"
flake_dir=$(cd "$here/.." && pwd) # nix/, whose flake.lock pins the nixpkgs we deploy with

for tool in git nix jq; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

rev=$(git ls-remote "https://github.com/$owner/$repo" "refs/heads/$branch" | cut -f1)
[ -n "$rev" ] || { echo "error: branch $branch not found on $owner/$repo" >&2; exit 1; }

current=$(sed -n 's/^    rev = "\([0-9a-f]\{40\}\)";/\1/p' "$pkg")
if [ "$rev" = "$current" ]; then
  echo "fut.nix already at $owner/$repo@$branch (${rev:0:7})"
  exit 0
fi
echo "updating ${current:0:7} -> ${rev:0:7} ($owner/$repo@$branch)"

prefetch=$(nix flake prefetch --json "github:$owner/$repo/$rev")
src_hash=$(jq -r .hash <<<"$prefetch")
store_path=$(jq -r .storePath <<<"$prefetch")
last_modified=$(jq -r .locked.lastModified <<<"$prefetch")

# Cargo.toml's version is upstream's release (0.34.0); fut tags drop the patch.
base=$(sed -n 's/^version = "\([0-9]*\.[0-9]*\)\..*"/\1/p' "$store_path/Cargo.toml" | head -n1)
date=$(date -u -r "$last_modified" +%F 2>/dev/null || date -u -d "@$last_modified" +%F)
version="$base-unstable-$date"

# fut.nix must pin the Ghostty commit this fut revision vendors.
ghostty_rev=$(sed -n 's/^const GHOSTTY_COMMIT: &str = "\([0-9a-f]\{40\}\)";/\1/p' \
  "$store_path/vendor/libghostty-vt-sys/build.rs")
[ -n "$ghostty_rev" ] || { echo "error: GHOSTTY_COMMIT not found in build.rs" >&2; exit 1; }
ghostty_hash=$(sed -n '/^      rev = /{n;s/^      hash = "\(.*\)";/\1/p;}' "$pkg")
if ! grep -q "^      rev = \"$ghostty_rev\";" "$pkg"; then
  echo "Ghostty pin changed -> ${ghostty_rev:0:7}"
  ghostty_hash=$(nix flake prefetch --json "github:ghostty-org/ghostty/$ghostty_rev" | jq -r .hash)
fi

backup=$(mktemp)
cp "$pkg" "$backup"
restore() { cp "$backup" "$pkg"; echo "error: restored the original fut.nix" >&2; }
trap 'rm -f "$backup"' EXIT
trap 'restore' ERR

# Rewrite via a temp file: `sed -i` differs between macOS and Linux.
set_attrs() {
  local cargo_hash=$1 tmp
  tmp=$(mktemp)
  sed \
    -e "s|^\(  version = \)\".*\";|\1\"$version\";|" \
    -e "s|^\(    rev = \)\".*\";|\1\"$rev\";|" \
    -e "/^    rev = /{n;s|^\(    hash = \)\".*\";|\1\"$src_hash\";|;}" \
    -e "s|^\(      rev = \)\".*\";|\1\"$ghostty_rev\";|" \
    -e "/^      rev = /{n;s|^\(      hash = \)\".*\";|\1\"$ghostty_hash\";|;}" \
    -e "s|^\(  cargoHash = \).*;|\1$cargo_hash;|" \
    "$pkg" >"$tmp"
  mv "$tmp" "$pkg"
}

# Build from the working tree (not the flake's git snapshot) so the edits
# count, with the nixpkgs and unfree setting the system config uses.
build() {
  nix build --no-link --print-out-paths --impure --expr "
    let
      flake = builtins.getFlake \"path:$flake_dir\";
      pkgs = import flake.inputs.nixpkgs {
        system = builtins.currentSystem;
        config.allowUnfree = true;
      };
    in (pkgs.callPackage $pkg { })$1"
}

set_attrs "lib.fakeHash"
echo "computing cargoHash..."
cargo_hash=$(build .cargoDeps 2>&1 | sed -n 's/^ *got: *\(sha256-.*\)$/\1/p' || true)
[ -n "$cargo_hash" ] || { echo "error: could not determine cargoHash" >&2; false; }
set_attrs "\"$cargo_hash\""

echo "building fut $version..."
build ""
build .extensions >/dev/null
trap - ERR

echo "fut.nix -> $version (${rev:0:7}); review with: git diff ${pkg#"$PWD/"}"

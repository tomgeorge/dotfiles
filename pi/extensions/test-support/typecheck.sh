#!/usr/bin/env bash
# Type-check pi/extensions against the installed Pi's own packages.
#
#   pi/extensions/test-support/typecheck.sh [extra tsc args]
#
# Pi's packages live in its nix store install, whose path changes on every
# upgrade, so this script finds them at run time from `pi` on PATH and writes a
# throwaway tsconfig (outside the repo) that extends ../tsconfig.json with
# `paths` into that install. It uses the TypeScript bundled with Pi when there
# is one, then $TSC, then `tsc` on PATH. Exits non-zero on type errors.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
base="$(dirname "$here")/tsconfig.json"

die() { echo "typecheck: $*" >&2; exit 2; }

pi_bin=$(command -v pi) || die "pi not found on PATH"
# Resolve symlinks portably (no GNU readlink -f on stock macOS).
pi_real=$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$pi_bin") ||
  die "can't resolve $pi_bin"
pi_lib="$(dirname "$(dirname "$pi_real")")/lib/node_modules/pi-monorepo"
[[ -f "$pi_lib/dist/index.d.ts" ]] || die "Pi's packages not found under $pi_lib (resolved from $pi_bin)"

if [[ -f "$pi_lib/node_modules/typescript/bin/tsc" ]]; then
  tsc=("node" "$pi_lib/node_modules/typescript/bin/tsc")
elif [[ -n "${TSC:-}" ]]; then
  tsc=("$TSC")
elif command -v tsc >/dev/null; then
  tsc=("tsc")
else
  die "no TypeScript found: Pi bundles none at $pi_lib/node_modules/typescript, \$TSC is unset, and tsc isn't on PATH"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
nm="$pi_lib/node_modules"
cat >"$tmp/tsconfig.json" <<EOF
{
  "extends": "$base",
  "compilerOptions": {
    "typeRoots": ["$nm/@types"],
    "paths": {
      "@earendil-works/pi-coding-agent": ["$pi_lib"],
      "*": ["$nm/*"]
    }
  }
}
EOF

echo "typecheck: $("${tsc[@]}" --version) with Pi at $pi_lib" >&2
"${tsc[@]}" -p "$tmp/tsconfig.json" "$@"

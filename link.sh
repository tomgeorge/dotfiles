#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

link() {
  local src="${DOTFILES_DIR}/$1"
  local dest="$2"

  if [[ ! -e "$src" ]]; then
    echo "warning: ${src} not found, skipping" >&2
    return
  fi

  mkdir -p "$(dirname "$dest")"

  if [[ -L "$dest" ]]; then
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    echo "warning: ${dest} exists and is not a symlink, backing up to ${dest}.bak" >&2
    mv "$dest" "${dest}.bak"
  fi

  ln -sfn "$src" "$dest"
  echo "linked ${dest} -> ${src}"
}

link nvim ~/.config/nvim
link wezterm ~/.config/wezterm

#!/usr/bin/env bash
#
# stow-setup.sh — restructure dotfiles for GNU Stow and symlink them into $HOME
#
# Usage:
#   ./stow-setup.sh              # restructure + stow everything
#   ./stow-setup.sh --stow-only  # skip restructuring, just run stow
#
# Stow packages (add/remove as needed):
PACKAGES=(nvim wezterm tmux)

set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
STOW_ONLY=false

if [[ "${1:-}" == "--stow-only" ]]; then
    STOW_ONLY=true
fi

# ---------- helpers ----------

info()  { printf "\033[1;34m==> %s\033[0m\n" "$1"; }
warn()  { printf "\033[1;33m==> %s\033[0m\n" "$1"; }
error() { printf "\033[1;31m==> %s\033[0m\n" "$1"; exit 1; }

# Move a directory's contents into stow-compatible nesting.
# restructure <package> <relative_target>
#   e.g. restructure nvim .config/nvim
#   moves  nvim/*  →  nvim/.config/nvim/*
restructure_dir() {
    local pkg="$1"
    local target="$2"
    local pkg_dir="${DOTFILES_DIR}/${pkg}"
    local nested="${pkg_dir}/${target}"

    if [[ -d "$nested" ]]; then
        info "${pkg}: already structured at ${target}, skipping"
        return
    fi

    if [[ ! -d "$pkg_dir" ]]; then
        warn "${pkg}: directory not found, skipping restructure"
        return
    fi

    info "${pkg}: restructuring → ${target}"
    local tmp
    tmp="$(mktemp -d "${DOTFILES_DIR}/.tmp-${pkg}-XXXX")"
    # Move current contents to temp
    mv "${pkg_dir}"/* "${pkg_dir}"/.??* "$tmp" 2>/dev/null || true
    # Create nested path and move contents back
    mkdir -p "$nested"
    mv "$tmp"/* "$tmp"/.??* "$nested" 2>/dev/null || true
    rmdir "$tmp"
}

# Wrap a loose file into a stow package directory.
# restructure_file <source_file> <package_name> <relative_target_path>
#   e.g. restructure_file tmux.conf tmux .config/tmux/tmux.conf
restructure_file() {
    local src_file="$1"
    local pkg="$2"
    local target="$3"
    local src_path="${DOTFILES_DIR}/${src_file}"
    local pkg_dir="${DOTFILES_DIR}/${pkg}"
    local dest="${pkg_dir}/${target}"

    if [[ -f "$dest" ]]; then
        info "${pkg}: already structured, skipping"
        return
    fi

    if [[ ! -f "$src_path" ]]; then
        warn "${pkg}: source file ${src_file} not found, skipping"
        return
    fi

    info "${pkg}: restructuring ${src_file} → ${pkg}/${target}"
    mkdir -p "$(dirname "$dest")"
    mv "$src_path" "$dest"
}

# Remove existing symlinks or files at the stow target so stow doesn't conflict.
clear_target() {
    local target="$1"
    local full="${HOME}/${target}"
    if [[ -L "$full" ]]; then
        info "Removing existing symlink: ${full}"
        rm "$full"
    elif [[ -e "$full" ]]; then
        warn "Backing up existing ${full} → ${full}.bak"
        mv "$full" "${full}.bak"
    fi
}

# ---------- restructure ----------

if [[ "$STOW_ONLY" == false ]]; then
    info "Restructuring packages for stow..."

    # nvim/ → nvim/.config/nvim/
    restructure_dir nvim .config/nvim

    # wezterm/ → wezterm/.config/wezterm/
    restructure_dir wezterm .config/wezterm

    # tmux.conf (loose file) → tmux/.config/tmux/tmux.conf
    restructure_file tmux.conf tmux .config/tmux/tmux.conf
fi

# ---------- stow ----------

if ! command -v stow &>/dev/null; then
    error "GNU stow not found. Run 'darwin-rebuild switch' first to install it via nix."
fi

info "Stowing packages from ${DOTFILES_DIR}..."

for pkg in "${PACKAGES[@]}"; do
    pkg_dir="${DOTFILES_DIR}/${pkg}"
    if [[ ! -d "$pkg_dir" ]]; then
        warn "${pkg}: package directory not found, skipping"
        continue
    fi

    # Clear known targets to avoid conflicts
    case "$pkg" in
        nvim)    clear_target .config/nvim ;;
        wezterm) clear_target .config/wezterm ;;
        tmux)    clear_target .config/tmux ;;
    esac

    info "Stowing ${pkg}"
    stow -v -d "$DOTFILES_DIR" -t "$HOME" "$pkg"
done

info "Done! Stowed packages: ${PACKAGES[*]}"

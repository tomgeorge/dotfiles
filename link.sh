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
link ghostty ~/.config/ghostty
# Only the config file: ~/.config/herdr also holds sockets, logs and plugins.json.
link herdr/config.toml ~/.config/herdr/config.toml
# herdr-nav (which nvim runs at its edge) and the herdr plugins are
# installed by `make link` in herdr-plugins/, which builds them first.
link claude/hooks ~/.claude/hooks
link claude/skills ~/.claude/skills
link pi/settings.json ~/.pi/agent/settings.json
link pi/AGENTS.md ~/.pi/agent/AGENTS.md
link pi/extensions/subagent ~/.pi/agent/extensions/subagent
link pi/extensions/vi-mode ~/.pi/agent/extensions/vi-mode
link pi/extensions/slack-mcp ~/.pi/agent/extensions/slack-mcp
# pi-only: Claude Code has Slack directly, so it shouldn't see a skill that calls itself.
link pi/skills/slack ~/.pi/agent/skills/slack

if [[ ! -x ~/.local/bin/herdr-nav ]]; then
  echo "note: herdr-nav isn't installed; run \`make link\` in herdr-plugins/ (nvim can't hand off to herdr or WezTerm without it)" >&2
fi

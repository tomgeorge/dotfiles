#!/usr/bin/env bash
rm ~/.zshrc || true
ln ~/dotfiles/zshrc ~/.zshrc
rm ~/.tmux.conf || true
ln ~/dotfiles/tmux.conf ~/.tmux.conf
rm ~/.vimrc || true
ln ~/dotfiles/vimrc ~/.vimrc
rm ~/.gitconfig || true
ln ~/dotfiles/gitconfig ~/.gitconfig
rm ~/.config/nvim/init.vim || true
mkdir -p ~/.config/nvim
ln ~/dotfiles/init.nvim ~/.config/nvim/init.vim 

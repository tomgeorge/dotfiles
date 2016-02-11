#!/usr/bin/env bash
rm ~/.zshrc || true
ln ~/dotfiles/zsh/.zshrc ~/.zshrc
rm ~/.tmux.conf || true
ln ~/dotfiles/tmux/.tmux.conf ~/.tmux.conf
rm ~/.vimrc || true
ln ~/dotfiles/vim/.vimrc ~/.vimrc
rm ~/.bashrc || true
ln ~/dotfiles/bash/.bashrc ~/.bashrc
rm ~/.gitconfig || true
ln ~/dotfiles/git/.gitconfig ~/.gitconfig || true       

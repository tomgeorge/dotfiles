#!/usr/bin/env bash
rm /home/$(whoami)/.zshrc || true
ln /home/vagrant/dotfiles/zsh/.zshrc /home/vagrant/.zshrc
rm /home/$(whoami)/.tmux.conf || true
ln /home/vagrant/dotfiles/tmux/.tmux.conf /home/vagrant/.tmux.conf
rm /home/$(whoami)/.vimrc || true
ln /home/vagrant/dotfiles/vim/.vimrc /home/vagrant/.vimrc
rm /home/$(whoami)/.bashrc || true
ln /home/vagrant/dotfiles/bash/.bashrc /home/vagrant/.bashrc
rm /home/$(whoami)/.gitconfig || true
ln /home/vagrant/dotfiles/git/.gitconfig /home/vagrant/.gitconfig || true       

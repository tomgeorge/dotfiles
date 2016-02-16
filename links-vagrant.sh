#!/usr/bin/env bash
rm /home/vagrant/.zshrc || true
ln /home/vagrant/dotfiles/zshrc /home/vagrant/.zshrc
rm /home/vagrant/.tmux.conf || true
ln /home/vagrant/dotfiles/tmux.conf /home/vagrant/.tmux.conf
rm /home/vagrant/.vimrc || true
ln /home/vagrant/dotfiles/vimrc /home/vagrant/.vimrc
rm /home/vagrant/.bashrc || true
ln /home/vagrant/dotfiles/bashrc /home/vagrant/.bashrc
rm /home/vagrant/.gitconfig || true
ln /home/vagrant/dotfiles/gitconfig /home/vagrant/.gitconfig || true       

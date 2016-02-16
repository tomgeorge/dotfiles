#!/usr/bin/env bash
rm /home/vagrant/.zshrc || true
ln /home/vagrant/dotfiles/zshrc ~/.zshrc
rm /home/vagrant/.tmux.conf || true
ln /home/vagrant/dotfiles/.tmux.conf ~/.tmux.conf
rm /home/vagrant/.vimrc || true
ln /home/vagrant/dotfiles/.vimrc ~/.vimrc
rm /home/vagrant/.bashrc || true
ln /home/vagrant/dotfiles/.bashrc ~/.bashrc
rm /home/vagrant/.gitconfig || true
ln /home/vagrant/dotfiles/.gitconfig ~/.gitconfig || true       

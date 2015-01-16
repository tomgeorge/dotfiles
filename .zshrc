# Path to your oh-my-zsh configuration.
ZSH=$HOME/.oh-my-zsh

# Set name of the theme to load.
# Look in ~/.oh-my-zsh/themes/
# Optionally, if you set this to "random", it'll load a random theme each
# time that oh-my-zsh is loaded.
# ZSH_THEME="robbyrussell"
ZSH_THEME="af-magic"
# ZSH_THEME="agnoster" 
# ZSH_THEME="lambda"
# ZSH_THEME="minimal"
# ZSH_THEME="ys"
# ZSH_THEME="garyblessington"
# ZSH_THEME="avit"
# ZSH_THEME="miloshadzic"
# ZSH_THEME="norm"

# Example aliases
alias zshconfig="mate ~/.zshrc"
alias ohmyzsh="mate ~/.oh-my-zsh"

# Set to this to use case-sensitive completion
# CASE_SENSITIVE="true"

# Uncomment this to disable bi-weekly auto-update checks
# DISABLE_AUTO_UPDATE="true"

# Uncomment to change how often before auto-updates occur? (in days)
# export UPDATE_ZSH_DAYS=13

# Uncomment following line if you want to disable colors in ls
# DISABLE_LS_COLORS="true"

# Uncomment following line if you want to disable autosetting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment following line if you want to disable command autocorrection
# DISABLE_CORRECTION="true"

# Uncomment following line if you want red dots to be displayed while waiting for completion
COMPLETION_WAITING_DOTS="true"

# Uncomment following line if you want to disable marking untracked files under
# VCS as dirty. This makes repository status check for large repositories much,
# much faster.
DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment following line if you want to  shown in the command execution time stamp 
# in the history command output. The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|
# yyyy-mm-dd
HIST_STAMPS="mm/dd/yyyy"

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
plugins=(git ruby vi-mode tmux brew common-aliases github gradle lein sudo wd)

source $ZSH/oh-my-zsh.sh

# User configuration

export PATH="/home/tom/bin:/home/tom/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games:/home/tom/.rvm/bin:/home/tom/.rvm/bin:/home/tom/.oh-my-zsh:/home/tom/.linuxbrew/bin:/home/tom/phantomjs-1.9.7-linux-i686/bin"
# export MANPATH="/usr/local/man:$MANPATH"

# # Preferred editor for local and remote sessions
 if [[ -n $SSH_CONNECTION ]]; then
   export EDITOR='vim'
 else
   export EDITOR='gvim'
 fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# ssh
# export SSH_KEY_PATH="~/.ssh/dsa_id"
alias tvi='/usr/local/bin/vim'
alias vi='vim'
export TERM=xterm-256color
alias tmux='tmux -2'
alias tml='tmux list-sessions'
alias tma='tmux attach-session -t '
export GRADLE_HOME=~/bin/gradle-1.11
export PATH=$GRADLE_HOME/bin:$PATH
# if [[ $(cat /etc/resolv.conf | wc -l) == 1 ]]
# then
#	sudo su 
#	echo "nameserver 208.67.222.222" >> /etc/resolv.conf
#	echo "nameserver 208.67.220.220" >> /etc/resolv.conf
#	exit
# fi
alias resolv='sudo cp ~/resolv.conf.bak /etc/resolv.conf'

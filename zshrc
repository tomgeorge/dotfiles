# Path to your oh-my-zsh installation.
# export ZSH=$HOME/.oh-my-zsh
if type "nvim" > /dev/null; then
    alias vi='nvim'
fi

if type "gpg2" > /dev/null; then
    alias gpg='gpg2'
fi

# Set name of the theme to load.
# Look in ~/.oh-my-zsh/themes/
# Optionally, if you set this to "random", it'll load a random theme each
# time that oh-my-zsh is loaded.
#ZSH_THEME="af-magic"
# ZSH_THEME="lambda"

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion. Case
# sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
# plugins=(git tmux docker asdf)

# User configuration

  export PATH="/usr/local/bin:/usr/local/bin/gradle:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:~/.local/bin:~/bin:~/.linuxbrew/bin:/usr/local/share/python:/usr/local/kubebuilder/bin:$PATH"
# export MANPATH="/usr/local/man:$MANPATH"

if [[ -n $HOME/.vim/plugged/vim-iced ]]; then
  export PATH="${HOME}/.vim/plugged/vim-iced/bin:$PATH"
fi

# source $ZSH/oh-my-zsh.sh

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# ssh
# export SSH_KEY_PATH="~/.ssh/dsa_id"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"
#
export LEIN_ROOT=1
alias em='emacs -nw'
fpath=(~/.zsh/completion $fpath)
autoload -Uz compinit && compinit -i

# Install vim stuff
set -o vi
alias dl='docker ps -l -q'


bindkey -v
bindkey '^R' history-incremental-search-backward
alias unset_proxy='unset {HTTP_PROXY,HTTPS_PROXY,http_proxy,https_proxy,no_proxy,NO_PROXY}'
export PATH=/usr/local/go/bin:$PATH
export GOPATH=~/go
export GOBIN=$GOPATH/bin
export PATH=$PATH:$(go env GOPATH)/bin

export JAVA_HOME=/usr/lib/jvm/java-1.8.0-openjdk/
# export JAVA_HOME=$HOME/bin/openjdk-11.0.5+10
# export GRAALVM_HOME=$HOME/bin/graalvm-ce-java11-19.3.1
export GRAALVM_HOME=$HOME/bin/graalvm-ce-19.2.1
# export GRAALVM_HOME=$HOME/bin/graalvm-ce-java11-20.2.0
export MAVEN_HOME=$HOME/bin/apache-maven-3.6.3
export PATH=$JAVA_HOME/bin:$MAVEN_HOME/bin:$GRAALVM_HOME/bin:$PATH

    

# added by travis gem
[ -f ~/.travis/travis.sh ] && source /home/vagrant/.travis/travis.sh
function run_dev_container() {
   cd ~/devbox && make
}

alias dev=run_dev_container
export GPG_TTY=$(tty)


# add Pulumi to the PATH
export PATH=$PATH:$HOME/.pulumi/bin
export GO111MODULE=auto    
alias kc='kubectl'
export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"
alias xclip='xclip -selection clipboard'
alias oc_comp='source <(oc completion zsh)'
alias kc_comp='source <(kc completion zsh)'

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/home/tgeorge/Downloads/google-cloud-sdk/path.zsh.inc' ]; then . '/home/tgeorge/Downloads/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/home/tgeorge/Downloads/google-cloud-sdk/completion.zsh.inc' ]; then . '/home/tgeorge/Downloads/google-cloud-sdk/completion.zsh.inc'; fi

export PATH="$HOME/.rbenv/bin:$PATH"

. $HOME/.asdf/asdf.sh
source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"

  export PKG_CONFIG_PATH="/usr/local/opt/libpq/lib/pkgconfig"
  export PATH="/usr/local/opt/libpq/bin:/home/tgeorge/.asdf/shims:/home/tgeorge/.asdf/bin:/home/tgeorge/.rbenv/bin:/home/tgeorge/.krew/bin:/usr/lib/jvm/java-1.8.0-openjdk//bin:/home/tgeorge/bin/apache-maven-3.6.3/bin:/home/tgeorge/bin/graalvm-ce-19.2.1/bin:/usr/local/go/bin:/home/tgeorge/.vim/plugged/vim-iced/bin:/usr/local/bin:/usr/local/bin/gradle:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:~/.local/bin:~/bin:~/.linuxbrew/bin:/usr/local/share/python:/usr/local/kubebuilder/bin:/usr/local/bin:/usr/local/sbin:/home/tgeorge/.rbenv/bin:/home/tgeorge/.krew/bin:/usr/lib/jvm/java-1.8.0-openjdk//bin:/home/tgeorge/bin/apache-maven-3.6.3/bin:/home/tgeorge/bin/graalvm-ce-19.2.1/bin:/usr/local/go/bin:/home/tgeorge/.vim/plugged/vim-iced/bin:/usr/local/bin/gradle:/usr/bin:/usr/sbin:/bin:/sbin:~/.local/bin:~/bin:~/.linuxbrew/bin:/usr/local/share/python:/usr/local/kubebuilder/bin:/home/tgeorge/.local/bin:/home/tgeorge/bin:/home/tgeorge/.cargo/bin:/home/tgeorge/.rvm/bin:/home/tgeorge/go/bin:/home/tgeorge/.pulumi/bin:/home/tgeorge/go/bin:/home/tgeorge/.pulumi/bin"

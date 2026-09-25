package herdr

import "strings"

// Recognising the program in a pane. Pair these with ProcessInfo.Find, which
// already strips any leading directory. Name lists follow herdrkit's apps.rs,
// MIT, github.com/joshrwolf/dots.

var vimNames = map[string]bool{
	"vi": true, "vim": true, "vimdiff": true, "view": true, "ex": true,
	"rvim": true, "rview": true, "evim": true, "eview": true,
	"nvi": true, "nvim": true, "nvimdiff": true,
}

// AcceptsVimNavigation reports whether name is a program that handles Vim's
// ctrl+h/j/k/l window moves: Vim under any of its invocation names, Neovim,
// and Debian's versioned alternatives such as vim.basic and vim.tiny.
func AcceptsVimNavigation(name string) bool {
	name = normalize(name)
	if vimNames[name] {
		return true
	}
	variant, ok := strings.CutPrefix(name, "vim.")
	return ok && variant != "" && strings.IndexFunc(variant, notWordChar) < 0
}

// IsFzf reports whether name is fzf itself, not a wrapper such as fzf-tmux.
func IsFzf(name string) bool {
	return normalize(name) == "fzf"
}

func normalize(name string) string {
	name = strings.ToLower(name)
	return strings.TrimSuffix(name, ".exe")
}

func notWordChar(r rune) bool {
	wordChar := r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_'
	return !wordChar
}

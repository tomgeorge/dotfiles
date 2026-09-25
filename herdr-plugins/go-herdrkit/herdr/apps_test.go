package herdr

import "testing"

func TestAcceptsVimNavigation(t *testing.T) {
	for _, name := range []string{
		"vim", "vi", "nvim", "NVIM", "vimdiff", "nvimdiff", "nvi", "view", "ex",
		"rvim", "rview", "evim", "eview", "vim.basic", "vim.tiny", "vim.exe", "nvimdiff.exe",
	} {
		if !AcceptsVimNavigation(name) {
			t.Errorf("%q should accept Vim navigation", name)
		}
	}
	for _, name := range []string{"vime", "novim", "vim.", "vim.a-b", "gvim", "vimtutor", "nvimpager", "fzf", ""} {
		if AcceptsVimNavigation(name) {
			t.Errorf("%q should not accept Vim navigation", name)
		}
	}
}

func TestIsFzf(t *testing.T) {
	for name, want := range map[string]bool{
		"fzf": true, "FZF.EXE": true, "fzf-tmux": false, "sk": false, "": false,
	} {
		if got := IsFzf(name); got != want {
			t.Errorf("IsFzf(%q) = %v, want %v", name, got, want)
		}
	}
}

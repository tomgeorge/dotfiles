//go:build e2e

package main

import (
	"os"
	"os/exec"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

// maxLatency catches regressions (an extra round trip, a slow startup),
// not a benchmark: a key-to-focus move measured ~25ms when written.
const maxLatency = 250 * time.Millisecond

// TestE2E drives a real herdr with real key presses. One server serves all
// cases; each starts in a new tab. Run with `make test-e2e`.
func TestE2E(t *testing.T) {
	h := newHarness(t)

	wantOuter := func(t *testing.T, want ...string) {
		t.Helper()
		if got := h.outer(); !reflect.DeepEqual(got, want) {
			t.Errorf("WezTerm handoffs = %q, want %q", got, want)
		}
	}
	checkLatency := func(t *testing.T, d time.Duration) {
		t.Helper()
		t.Logf("key to focus: %v", d)
		if d > maxLatency {
			t.Errorf("took %v, over %v", d, maxLatency)
		}
	}

	t.Run("1 ctrl+h moves between shells", func(t *testing.T) {
		h := h.at(t)
		_, p1 := h.newTab()
		h.splitRight()
		h.keys("C-h")
		checkLatency(t, h.waitFocused(p1))
		wantOuter(t)
	})

	t.Run("2 ctrl+h at herdr's edge hands off to WezTerm", func(t *testing.T) {
		h := h.at(t)
		_, p1 := h.newTab()
		h.splitRight()
		h.focusDir("h", p1, 0)
		h.keys("C-h")
		h.poll("handoff", waitFor, func() bool { return len(h.outer()) > 0 })
		wantOuter(t, "pane left")
		if got := h.focused(); got != p1 {
			t.Errorf("focused %s, want %s", got, p1)
		}
	})

	t.Run("3 ctrl+h goes to nvim when it has a window that way", func(t *testing.T) {
		h := h.at(t)
		h.newTab()
		p2 := h.splitRight()
		nv := h.nvim(p2, "-c vsplit")
		nv.send("<C-w>l")
		nv.waitWin("2")
		h.keys("C-h")
		nv.waitWin("1")
		if got := h.focused(); got != p2 {
			t.Errorf("herdr focus moved to %s", got)
		}
		wantOuter(t)
	})

	t.Run("4 ctrl+h at nvim's edge moves herdr focus", func(t *testing.T) {
		h := h.at(t)
		_, p1 := h.newTab()
		p2 := h.splitRight()
		nv := h.nvim(p2, "-c vsplit")
		nv.waitWin("1")
		h.keys("C-h")
		checkLatency(t, h.waitFocused(p1))
		wantOuter(t)
	})

	t.Run("4b ctrl+h at nvim's and herdr's edge hands off to WezTerm", func(t *testing.T) {
		h := h.at(t)
		_, p1 := h.newTab()
		nv := h.nvim(p1, "")
		h.keys("C-h")
		h.poll("handoff", waitFor, func() bool { return len(h.outer()) > 0 })
		wantOuter(t, "pane left")
		if got := nv.expr("winnr()"); got != "1" {
			t.Errorf("nvim window %s", got)
		}
	})

	t.Run("5 fzf gets ctrl+j/k but not ctrl+h", func(t *testing.T) {
		if _, err := exec.LookPath("fzf"); err != nil {
			t.Skip("fzf not on PATH")
		}
		h := h.at(t)
		_, p1 := h.newTab()
		p2 := h.splitRight()
		h.run(p2, "seq 5 | fzf --pointer='>' --no-color", "fzf")
		selected := regexp.MustCompile(`(?m)^> (\d)\s*$`)
		pick := func() string {
			m := selected.FindStringSubmatch(h.screen(p2))
			if m == nil {
				return ""
			}
			return m[1]
		}
		h.poll("fzf to draw", waitFor, func() bool { return pick() == "1" })
		h.keys("C-k")
		h.poll("fzf to move up", waitFor, func() bool { return pick() == "2" })
		h.keys("C-j")
		h.poll("fzf to move down", waitFor, func() bool { return pick() == "1" })
		if got := h.focused(); got != p2 {
			t.Fatalf("herdr focus moved to %s", got)
		}
		h.keys("C-h")
		h.waitFocused(p1)
		wantOuter(t)
	})

	t.Run("6-8 prefix+]/[ step through tabs, then hand off", func(t *testing.T) {
		h := h.at(t)
		h.newTab()
		h.newTab() // the last tab, and at least tabs 1 and 2 exist
		tabs := h.tabs()
		last, beforeLast := tabs[len(tabs)-1].TabID, tabs[len(tabs)-2].TabID

		h.keys("C-a", "]")
		h.poll("handoff", waitFor, func() bool { return len(h.outer()) > 0 })
		wantOuter(t, "tab +1")
		if got := h.focusedTab(); got != last {
			t.Errorf("past the last tab: focused %s, want %s", got, last)
		}

		h.resetOuter()
		h.keys("C-a", "[")
		h.poll("previous tab", waitFor, func() bool { return h.focusedTab() == beforeLast })
		h.waitClient(len(tabs)-1, 0)

		h.focusTabNumber(1)
		h.keys("C-a", "]")
		h.poll("tab 2", waitFor, func() bool { return h.focusedTab() == tabs[1].TabID })

		h.focusTabNumber(1)
		h.keys("C-a", "[")
		h.poll("handoff", waitFor, func() bool { return len(h.outer()) > 0 })
		wantOuter(t, "tab -1")
	})

	t.Run("9 prefix+y enters copy mode", func(t *testing.T) {
		h := h.at(t)
		h.newTab()
		h.keys("C-a", "y")
		h.poll("copy mode bar", waitFor, func() bool { return strings.Contains(h.clientScreen(), " COPY ") })
		h.keys("Escape")
		h.poll("copy mode to exit", waitFor, func() bool { return !strings.Contains(h.clientScreen(), " COPY ") })
	})

	t.Run("10 prefix+ctrl+l sends a literal ctrl+l", func(t *testing.T) {
		// Checks delivery, not clearing: whether ctrl+l clears depends on the
		// shell (nix's non-interactive bash, used here as sh, has no readline).
		h := h.at(t)
		_, p1 := h.newTab()
		h.run(p1, "cat -v", "cat")
		h.keys("C-a", "C-l")
		h.keys("Enter")
		h.poll("^L to reach cat", waitFor, func() bool { return strings.Contains(h.screen(p1), "^L") })
		wantOuter(t) // tg.nav's ctrl+l (right) didn't fire
	})

	t.Run("11 prefix+% and prefix+' split", func(t *testing.T) {
		h := h.at(t)
		tab, _ := h.newTab()
		count := func() int {
			var r struct{ Panes []paneInfo }
			h.herdrJSON(&r, "pane", "list")
			n := 0
			for _, p := range r.Panes {
				if p.TabID == tab {
					n++
				}
			}
			return n
		}
		h.keys("C-a", "%")
		h.poll("split from prefix+%", waitFor, func() bool { return count() == 2 })
		h.keys("C-a", "'")
		h.poll("split from prefix+'", waitFor, func() bool { return count() == 3 })
	})

	// Key repeat and fast typing: no waiting between keys, so each action
	// may start before the client has drawn the previous move.
	t.Run("12 bursts of ctrl+h/l land where one-at-a-time would", func(t *testing.T) {
		h := h.at(t)
		_, a := h.newTab()
		b := h.splitRight()
		c := h.splitRight()

		h.keys("C-h", "C-h")
		h.waitFocused(a)
		wantOuter(t)
		h.waitClient(h.focusedTabNumber(), 0) // before herdr's own prefix+l below

		h.focusDir("l", b, 1)
		h.focusDir("l", c, 2)
		h.keys("C-h", "C-l")
		h.poll("settle", waitFor, func() bool { return h.focused() == c })
		wantOuter(t)
	})

	// Runs last: a second workspace would change where 6-8's edges are.
	t.Run("13 prefix+]/[ continue into the next/previous workspace", func(t *testing.T) {
		h := h.at(t)
		ws1Last, _ := h.newTab() // ws1's last tab, focused
		ws1Number := h.focusedTabNumber()

		var created struct {
			Workspace struct {
				WorkspaceID string `json:"workspace_id"`
			}
			Tab struct {
				TabID string `json:"tab_id"`
			}
		}
		h.herdrJSON(&created, "workspace", "create", "--cwd", h.home) // not focused
		ws2, ws2First := created.Workspace.WorkspaceID, created.Tab.TabID
		t.Cleanup(func() {
			if os.Getenv("HN_KEEP") == "" {
				_, _ = h.tryHerdr("workspace", "close", ws2)
			}
		})
		var second struct {
			Tab struct {
				TabID string `json:"tab_id"`
			}
		}
		h.herdrJSON(&second, "tab", "create", "--workspace", ws2, "--cwd", h.home)
		ws2Last := second.Tab.TabID

		step := func(key, wantTab string, wantNumber int) {
			t.Helper()
			h.keys("C-a", key)
			h.poll("tab "+wantTab, waitFor, func() bool { return h.focusedTab() == wantTab })
			h.waitClient(wantNumber, 0)
		}
		step("]", ws2First, 1)
		step("]", ws2Last, 2)

		h.keys("C-a", "]") // past the last workspace
		h.poll("handoff", waitFor, func() bool { return len(h.outer()) > 0 })
		wantOuter(t, "tab +1")

		h.resetOuter()
		step("[", ws2First, 1)
		step("[", ws1Last, ws1Number)
		wantOuter(t)
	})
}

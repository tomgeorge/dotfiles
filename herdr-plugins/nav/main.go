// Command herdr-nav moves focus across nvim, herdr and WezTerm with one set
// of keys. Each layer handles a key if it can and otherwise passes it out.
//
// As a herdr plugin action (HERDR_PLUGIN_ACTION_ID set) it runs for
// ctrl+h/j/k/l and the tab keys. Run as `herdr-nav pane <dir>` it's nvim in
// a herdr pane handing off at its own edge. (nvim outside herdr hands off
// to WezTerm itself; see nvim/lua/nav.lua.)
package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

func main() {
	if err := run(os.Args[1:], os.Stderr); err != nil {
		// Herdr records stderr in the plugin log: herdr plugin log list --plugin tg.nav
		fmt.Fprintln(os.Stderr, "herdr-nav:", err)
		os.Exit(1)
	}
}

const usage = "usage: herdr-nav pane left|down|up|right (or run as a tg.nav plugin action)"

var directions = map[string]herdr.Direction{
	"left": herdr.Left, "down": herdr.Down, "up": herdr.Up, "right": herdr.Right,
}

// runBudget bounds one key's work once it holds the lock. Waiting for the
// lock has its own, shorter, budget (lockWait).
const runBudget = 2 * time.Second

func run(args []string, log io.Writer) error {
	// Arguments win over HERDR_PLUGIN_ACTION_ID: nvim started from a plugin
	// action can inherit it, and treating nvim's edge call as a herdr key
	// would forward ctrl+h straight back to nvim, looping forever.
	action := os.Getenv("HERDR_PLUGIN_ACTION_ID")
	fromNvim := action == "" || len(args) != 0
	var dir herdr.Direction
	if fromNvim {
		if len(args) != 2 || args[0] != "pane" {
			return fmt.Errorf("%s", usage)
		}
		var ok bool
		if dir, ok = directions[args[1]]; !ok {
			return fmt.Errorf("unknown direction %q; %s", args[1], usage)
		}
	} else if action != "tab-next" && action != "tab-prev" {
		var ok bool
		if dir, ok = directions[action]; !ok {
			return fmt.Errorf("unknown action %q", action)
		}
	}

	socket := os.Getenv("HERDR_SOCKET_PATH")
	if socket == "" {
		return herdr.ErrNoSocket
	}
	lock, err := lockNav(context.Background(), socket, log)
	if err != nil {
		return err
	}
	defer lock.unlock()
	ctx, cancel := context.WithTimeout(context.Background(), runBudget)
	defer cancel()

	api := herdr.New(socket)
	n := navigator{api: api, outer: newOuter(api, log), moves: lock, log: log}
	switch {
	case fromNvim:
		// HERDR_PANE_ID in nvim's environment names nvim's own pane.
		return n.edge(ctx, herdr.PaneID(os.Getenv("HERDR_PANE_ID")), dir)
	case action == "tab-next":
		return n.tabMove(ctx, 1)
	case action == "tab-prev":
		return n.tabMove(ctx, -1)
	}
	// Server focus, not HERDR_PANE_ID/HERDR_TAB_ID (see navigator).
	return n.key(ctx, dir)
}

// newOuter is WezTerm, or for the e2e tests a log (HERDR_NAV_OUTER_LOG)
// that finds the host pane in tmux (HERDR_NAV_OUTER_TMUX: tmux's server
// arguments, e.g. "-L name").
func newOuter(api *herdr.Client, log io.Writer) Outer {
	if p := os.Getenv("HERDR_NAV_OUTER_LOG"); p != "" {
		o := &logOuter{path: p, titles: api, log: log}
		if t := os.Getenv("HERDR_NAV_OUTER_TMUX"); t != "" {
			o.list = tmuxPanes(strings.Fields(t))
		}
		return o
	}
	return newWezterm(api, log)
}

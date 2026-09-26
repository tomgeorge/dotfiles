// Command herdr-nav moves focus across nvim, herdr and WezTerm with one set
// of keys. Each layer handles a key if it can and otherwise passes it out.
//
// As a herdr plugin action (HERDR_PLUGIN_ACTION_ID set) it runs for
// ctrl+h/j/k/l and the tab keys. Run as `herdr-nav pane <dir>` it's nvim
// handing off at its own edge.
package main

import (
	"context"
	"fmt"
	"io"
	"os"
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

func run(args []string, log io.Writer) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	socket := os.Getenv("HERDR_SOCKET_PATH")
	var outer Outer = newWezterm(socket != "", log)
	if p := os.Getenv("HERDR_NAV_OUTER_LOG"); p != "" {
		outer = &logOuter{path: p}
	}

	// Arguments win over HERDR_PLUGIN_ACTION_ID: nvim started from a plugin
	// action can inherit it, and treating nvim's edge call as a herdr key
	// would forward ctrl+h straight back to nvim, looping forever.
	if action := os.Getenv("HERDR_PLUGIN_ACTION_ID"); action != "" && len(args) == 0 {
		if socket == "" {
			return herdr.ErrNoSocket
		}
		unlock := lockNav(ctx, socket, log)
		defer unlock()
		// Server focus, not HERDR_PANE_ID/HERDR_TAB_ID (see navigator).
		n := navigator{api: herdr.New(socket), outer: outer, log: log}
		switch action {
		case "tab-next":
			return n.tabMove(ctx, 1)
		case "tab-prev":
			return n.tabMove(ctx, -1)
		}
		dir, ok := directions[action]
		if !ok {
			return fmt.Errorf("unknown action %q", action)
		}
		return n.paneMove(ctx, dir, true)
	}

	if len(args) != 2 || args[0] != "pane" {
		return fmt.Errorf("%s", usage)
	}
	dir, ok := directions[args[1]]
	if !ok {
		return fmt.Errorf("unknown direction %q; %s", args[1], usage)
	}
	if socket == "" {
		// Plain nvim in WezTerm: nothing between them.
		return outer.PaneDirection(ctx, dir)
	}
	unlock := lockNav(ctx, socket, log)
	defer unlock()
	// nvim's own pane is the right origin here, and HERDR_PANE_ID in nvim's
	// environment names it exactly.
	n := navigator{
		api:   herdr.New(socket),
		outer: outer,
		pane:  herdr.PaneID(os.Getenv("HERDR_PANE_ID")),
		log:   log,
	}
	return n.paneMove(ctx, dir, false)
}

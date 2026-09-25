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

	if action := os.Getenv("HERDR_PLUGIN_ACTION_ID"); action != "" {
		if socket == "" {
			return herdr.ErrNoSocket
		}
		n := newNavigator(socket, outer, log)
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
	return newNavigator(socket, outer, log).paneMove(ctx, dir, false)
}

func newNavigator(socket string, outer Outer, log io.Writer) navigator {
	return navigator{
		api:       herdr.New(socket),
		outer:     outer,
		pane:      herdr.PaneID(os.Getenv("HERDR_PANE_ID")),
		tab:       herdr.TabID(os.Getenv("HERDR_TAB_ID")),
		workspace: herdr.WorkspaceID(os.Getenv("HERDR_WORKSPACE_ID")),
		log:       log,
	}
}

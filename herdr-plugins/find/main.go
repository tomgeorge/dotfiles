// Command herdr-find is one picker over every workspace, live agent,
// worktree and zoxide directory worth jumping to. It runs as the popup of
// the tg.find plugin for Herdr, a terminal multiplexer: Enter goes to the
// chosen place, Escape closes.
//
// A run is three steps: collect reads Herdr's session and zoxide into
// Sources, Sources.Destinations turns them into rows for the picker, and
// open takes the user to the one they chose.
//
// A Go port of herdr-find, MIT, github.com/joshrwolf/dots.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/term"

	"github.com/tomgeorge/go-herdrkit/herdr"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/picker"
	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

// Budgets for the socket work either side of the picker. The picker itself
// waits on the user and has none.
const (
	collectBudget = 5 * time.Second
	openBudget    = 10 * time.Second
)

func main() {
	log, path, lerr := openLog(os.Getenv("HERDR_PLUGIN_STATE_DIR"))
	if err := run(log); err != nil {
		// A popup that exits silently looks like a dead keybinding, so hold
		// the error on screen. The popup's text can't be copied, so it's
		// also logged.
		log.Error("find failed", "err", err)
		_, _ = fmt.Fprintln(os.Stderr, "herdr-find:", err)
		if lerr != nil {
			_, _ = fmt.Fprintln(os.Stderr, "(not logged:", lerr, ")")
		} else if path != "" {
			_, _ = fmt.Fprintln(os.Stderr, "(logged to", path+")")
		}
		holdForKey(os.Stdin, os.Stderr)
		os.Exit(1)
	}
}

// openLog opens a logger that appends to errors.log in dir, the plugin's
// state directory, and returns the file's path. The file is the only
// lasting record: Herdr doesn't keep a pane's stderr, and while the picker
// is up its screen covers anything printed before it. With no dir (not run
// by Herdr), or when the file can't be opened, the logger discards
// everything.
func openLog(dir string) (*slog.Logger, string, error) {
	discard := slog.New(slog.DiscardHandler)
	if dir == "" {
		return discard, "", nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return discard, "", err
	}
	path := filepath.Join(dir, "errors.log")
	// Never closed: it's written until the process exits.
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return discard, "", err
	}
	return slog.New(slog.NewTextHandler(f, nil)), path, nil
}

// run reads the environment Herdr launched the popup with, then calls find.
func run(log *slog.Logger) error {
	if id := os.Getenv("HERDR_PLUGIN_ENTRYPOINT_ID"); id != "picker" {
		return fmt.Errorf("must be launched by the tg.find picker pane entrypoint, got %q", id)
	}
	c, err := herdr.FromEnv()
	if err != nil {
		return err
	}
	home, _ := os.UserHomeDir() // without it, paths are just shown in full
	t := theme.Load()
	picker.ScorePaths() // most rows are paths
	pick := func(ds []Destination) (Destination, bool, error) {
		chosen, ok, err := picker.New(entries(ds, t)).
			Groups(groups()...).Palette(palette(t)).Prompt("⚡  ").Run()
		return chosen.Destination, ok, err
	}
	return find(c, "zoxide", home, pick, log)
}

// chooser shows destinations and returns the one chosen; ok is false when
// the user backed out.
type chooser func([]Destination) (chosen Destination, ok bool, err error)

// find is one run: collect the destinations, let the user pick one, go
// there. Backing out of the picker isn't an error. Sources that were left
// out are logged as warnings.
func find(c api, zoxide, home string, pick chooser, log *slog.Logger) error {
	ctx, cancel := context.WithTimeout(context.Background(), collectBudget)
	sources, err := collect(ctx, c, zoxide, log)
	cancel()
	if err != nil {
		return err
	}
	dests := sources.Destinations(home)
	if len(dests) == 0 {
		return errors.New("nothing to jump to")
	}

	chosen, ok, err := pick(dests)
	if err != nil || !ok {
		return err
	}
	ctx, cancel = context.WithTimeout(context.Background(), openBudget)
	defer cancel()
	return open(ctx, c, chosen)
}

// holdForKey waits for one key, so an error stays readable. Raw mode makes
// any key do; without it the terminal would buffer until Enter.
func holdForKey(in *os.File, out io.Writer) {
	fd := int(in.Fd())
	if !term.IsTerminal(fd) {
		return
	}
	_, _ = fmt.Fprint(out, "\n(press any key to close)")
	if state, err := term.MakeRaw(fd); err == nil {
		defer func() { _ = term.Restore(fd, state) }()
	}
	_, _ = in.Read(make([]byte, 1))
}

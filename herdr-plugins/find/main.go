// Command herdr-find is one picker over every workspace, live agent,
// worktree and zoxide directory worth jumping to. It runs as the tg.find
// plugin's popup; Enter goes there, Escape closes.
//
// A Go port of herdr-find, MIT, github.com/joshrwolf/dots.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/term"

	"github.com/tomgeorge/go-herdrkit/herdr"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/picker"
)

// Budgets for the socket work either side of the picker. The picker itself
// waits on the user and has none.
const (
	collectBudget  = 5 * time.Second
	dispatchBudget = 10 * time.Second
)

func main() {
	if err := run(os.Stderr); err != nil {
		// A popup that exits silently looks like a dead keybinding, so hold
		// the error on screen. The popup's text can't be copied and Herdr
		// doesn't log a pane's stderr, so it's also appended to a file.
		_, _ = fmt.Fprintln(os.Stderr, "herdr-find:", err)
		if path, lerr := logError(os.Getenv("HERDR_PLUGIN_STATE_DIR"), err, time.Now()); lerr != nil {
			_, _ = fmt.Fprintln(os.Stderr, "(not logged:", lerr, ")")
		} else if path != "" {
			_, _ = fmt.Fprintln(os.Stderr, "(logged to", path+")")
		}
		holdForKey(os.Stdin, os.Stderr)
		os.Exit(1)
	}
}

// logError appends err to errors.log in dir, returning the file's path. It
// logs nothing, and returns "", when dir is empty (not run by Herdr).
func logError(dir string, err error, now time.Time) (string, error) {
	if dir == "" {
		return "", nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "errors.log")
	f, err2 := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err2 != nil {
		return "", err2
	}
	_, werr := fmt.Fprintf(f, "%s %v\n", now.Format(time.RFC3339), err)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	return path, werr
}

func run(log io.Writer) error {
	if id := os.Getenv("HERDR_PLUGIN_ENTRYPOINT_ID"); id != "picker" {
		return fmt.Errorf("must be launched by the tg.find picker pane entrypoint, got %q", id)
	}
	c, err := herdr.FromEnv()
	if err != nil {
		return err
	}
	home, _ := os.UserHomeDir() // without it, paths are just shown in full

	ctx, cancel := context.WithTimeout(context.Background(), collectBudget)
	sources, err := collect(ctx, c, "zoxide", log)
	cancel()
	if err != nil {
		return err
	}
	dests := sources.Destinations(home)
	if len(dests) == 0 {
		return errors.New("nothing to jump to")
	}

	chosen, ok, err := picker.New(dests).Groups(groups()...).Prompt("⚡  ").MatchPaths().Run()
	if err != nil || !ok {
		return err
	}
	ctx, cancel = context.WithTimeout(context.Background(), dispatchBudget)
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

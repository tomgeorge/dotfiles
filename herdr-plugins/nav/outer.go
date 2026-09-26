package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// Outer is the terminal herdr runs in, which takes over past herdr's edges.
type Outer interface {
	PaneDirection(ctx context.Context, dir herdr.Direction) error
	Tab(ctx context.Context, delta int) error
}

// titler sets the outer terminal's title through herdr's foreground
// client; *herdr.Client is one.
type titler interface {
	SetWindowTitle(ctx context.Context, title string) (herdr.WindowTitleResult, error)
	ClearWindowTitle(ctx context.Context) (herdr.WindowTitleResult, error)
}

// termPane is an outer terminal pane and its title.
type termPane struct {
	ID    string
	Title string
}

// hostWait bounds the wait for a title to show up in the outer terminal.
// The client writes it on its next frame; locally that's well under this.
const hostWait = 400 * time.Millisecond

// findHost finds the outer terminal pane that shows this herdr server's
// foreground client (the one the key came from). It has herdr put a unique
// title on that client's terminal and looks for the pane carrying it, so
// herdr attached from another terminal, over ssh or suspended matches
// nothing, and another herdr in the outer terminal can't be mistaken for
// this one. ok is false, after a log line, when there's no such pane.
func findHost(ctx context.Context, t titler, list func(context.Context) ([]termPane, error), log io.Writer) (string, bool, error) {
	nonce := fmt.Sprintf("herdr-nav %d.%d", os.Getpid(), time.Now().UnixNano())
	r, err := t.SetWindowTitle(ctx, nonce)
	if err != nil {
		return "", false, fmt.Errorf("set window title: %w", err)
	}
	// Restore ui.window_title even if ctx is spent.
	defer func() {
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer cancel()
		if _, err := t.ClearWindowTitle(cctx); err != nil {
			_, _ = fmt.Fprintf(log, "clear window title: %v\n", err)
		}
	}()
	if r.Reason == herdr.WindowTitleNoForegroundClient {
		_, _ = fmt.Fprintln(log, "no herdr client in front; not handing off")
		return "", false, nil
	}
	deadline := time.Now().Add(hostWait)
	for {
		panes, err := list(ctx)
		if err != nil {
			return "", false, err
		}
		if i := slices.IndexFunc(panes, func(p termPane) bool { return p.Title == nonce }); i >= 0 {
			return panes[i].ID, true, nil
		}
		if time.Now().After(deadline) {
			_, _ = fmt.Fprintln(log, "herdr's client isn't in an outer terminal pane nav can drive; not handing off")
			return "", false, nil
		}
		select {
		case <-ctx.Done():
			return "", false, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// logOuter records handoffs instead of performing them. The e2e tests set
// HERDR_NAV_OUTER_LOG to use it, since WezTerm's GUI can't run headless.
// With a titler and list (the tests' tmux) it finds the host pane the way
// wezterm does and logs it too. Each line is one O_APPEND write, so
// concurrent invocations don't interleave.
type logOuter struct {
	path   string
	titles titler
	list   func(context.Context) ([]termPane, error)
	log    io.Writer
}

func (o *logOuter) PaneDirection(ctx context.Context, dir herdr.Direction) error {
	return o.append(ctx, "pane "+string(dir))
}

func (o *logOuter) Tab(ctx context.Context, delta int) error {
	return o.append(ctx, fmt.Sprintf("tab %+d", delta))
}

func (o *logOuter) append(ctx context.Context, line string) error {
	if o.list != nil {
		host, ok, err := findHost(ctx, o.titles, o.list, o.log)
		if err != nil || !ok {
			return err
		}
		line += " " + host
	}
	f, err := os.OpenFile(o.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintln(f, line); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// tmuxPanes lists every pane of the tmux server args select (e2e only).
func tmuxPanes(args []string) func(context.Context) ([]termPane, error) {
	return func(ctx context.Context) ([]termPane, error) {
		out, err := runCmd(ctx, nil, "tmux", append(args, "list-panes", "-a", "-F", "#{pane_id}\t#{pane_title}")...)
		if err != nil {
			return nil, fmt.Errorf("tmux list-panes: %w", err)
		}
		var panes []termPane
		for _, line := range strings.Split(strings.TrimSuffix(string(out), "\n"), "\n") {
			id, title, _ := strings.Cut(line, "\t")
			panes = append(panes, termPane{ID: id, Title: title})
		}
		return panes, nil
	}
}

// runCmd runs name and returns its stdout, with stderr in the error. The
// WaitDelay stops a child that leaves the output pipe open (a wrapper that
// forks) from hanging Output past ctx..
func runCmd(ctx context.Context, env []string, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = env
	cmd.WaitDelay = 100 * time.Millisecond
	out, err := cmd.Output()
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
		err = fmt.Errorf("%w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
	}
	return out, err
}

// wezterm drives WezTerm through `wezterm cli`. Every call passes
// --no-auto-start: when it can't reach the GUI it otherwise spends seconds
// starting a stray wezterm-mux-server.
type wezterm struct {
	bin    string // empty when wezterm isn't installed
	titles titler
	log    io.Writer
	// run executes wezterm; tests substitute it.
	run func(ctx context.Context, args ...string) ([]byte, error)
}

func newWezterm(titles titler, log io.Writer) *wezterm {
	// Inherited from wherever the herdr server started and named after that
	// GUI's pid: after a WezTerm restart it points at nothing. Without it
	// wezterm finds the running GUI itself.
	env := slices.DeleteFunc(os.Environ(), func(kv string) bool { return strings.HasPrefix(kv, "WEZTERM_UNIX_SOCKET=") })
	w := &wezterm{bin: findWezterm(), titles: titles, log: log}
	w.run = func(ctx context.Context, args ...string) ([]byte, error) {
		return runCmd(ctx, env, w.bin, append([]string{"cli", "--no-auto-start"}, args...)...)
	}
	return w
}

// findWezterm looks on PATH, then in the nix-darwin profile: the herdr
// server's PATH may not include it.
func findWezterm() string {
	if p, err := exec.LookPath("wezterm"); err == nil {
		return p
	}
	p := filepath.Join("/etc/profiles/per-user", os.Getenv("USER"), "bin/wezterm")
	if _, err := os.Stat(p); err == nil {
		return p
	}
	return ""
}

var weztermDirs = map[herdr.Direction]string{
	herdr.Left: "Left", herdr.Right: "Right", herdr.Up: "Up", herdr.Down: "Down",
}

func (w *wezterm) PaneDirection(ctx context.Context, dir herdr.Direction) error {
	pane, ok, err := w.hostPane(ctx)
	if !ok || err != nil {
		return err
	}
	_, err = w.run(ctx, "activate-pane-direction", "--pane-id", pane, weztermDirs[dir])
	return err
}

func (w *wezterm) Tab(ctx context.Context, delta int) error {
	pane, ok, err := w.hostPane(ctx)
	if !ok || err != nil {
		return err
	}
	_, err = w.run(ctx, "activate-tab", "--tab-relative", strconv.Itoa(delta), "--pane-id", pane)
	return err
}

// hostPane is the WezTerm pane herdr's foreground client runs in.
func (w *wezterm) hostPane(ctx context.Context) (string, bool, error) {
	if w.bin == "" {
		_, _ = fmt.Fprintln(w.log, "wezterm not found; not handing off")
		return "", false, nil
	}
	return findHost(ctx, w.titles, w.panes, w.log)
}

// panes lists WezTerm's panes with their titles.
func (w *wezterm) panes(ctx context.Context) ([]termPane, error) {
	out, err := w.run(ctx, "list", "--format", "json")
	if err != nil {
		return nil, fmt.Errorf("wezterm list: %w", err)
	}
	var list []struct {
		PaneID uint64 `json:"pane_id"`
		Title  string `json:"title"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return nil, fmt.Errorf("wezterm list: %w", err)
	}
	panes := make([]termPane, len(list))
	for i, p := range list {
		panes[i] = termPane{ID: strconv.FormatUint(p.PaneID, 10), Title: p.Title}
	}
	return panes, nil
}

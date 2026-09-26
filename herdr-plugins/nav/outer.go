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

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// Outer is the terminal herdr runs in, which takes over past herdr's edges.
type Outer interface {
	PaneDirection(ctx context.Context, dir herdr.Direction) error
	Tab(ctx context.Context, delta int) error
}

// logOuter records handoffs instead of performing them. The e2e tests set
// HERDR_NAV_OUTER_LOG to use it, since WezTerm's GUI can't run headless.
// Each line is one O_APPEND write, so concurrent invocations don't interleave.
type logOuter struct {
	path string
}

func (o *logOuter) PaneDirection(_ context.Context, dir herdr.Direction) error {
	return o.append("pane " + string(dir))
}

func (o *logOuter) Tab(_ context.Context, delta int) error {
	return o.append(fmt.Sprintf("tab %+d", delta))
}

func (o *logOuter) append(line string) error {
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

// wezterm drives WezTerm through `wezterm cli`.
// Every `wezterm cli` call passes --no-auto-start: when it can't reach the
// GUI it otherwise spends seconds starting a stray wezterm-mux-server.
type wezterm struct {
	bin string // empty when wezterm isn't installed
	// pane is $WEZTERM_PANE, trusted only outside herdr: herdr panes inherit
	// it from wherever the server started, so inside herdr it's stale.
	pane        string
	insideHerdr bool
	log         io.Writer
	// run executes wezterm; tests substitute it.
	run func(ctx context.Context, bin string, args ...string) ([]byte, error)
}

func newWezterm(insideHerdr bool, log io.Writer) *wezterm {
	env := os.Environ()
	if insideHerdr {
		// Inherited from wherever the herdr server started, like
		// WEZTERM_PANE, and named after that GUI's pid: after a WezTerm
		// restart it points at nothing. Without it wezterm finds the
		// running GUI itself.
		env = slices.DeleteFunc(env, func(kv string) bool { return strings.HasPrefix(kv, "WEZTERM_UNIX_SOCKET=") })
	}
	return &wezterm{
		bin:         findWezterm(),
		pane:        os.Getenv("WEZTERM_PANE"),
		insideHerdr: insideHerdr,
		log:         log,
		run: func(ctx context.Context, bin string, args ...string) ([]byte, error) {
			cmd := exec.CommandContext(ctx, bin, args...)
			cmd.Env = env
			out, err := cmd.Output()
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
				err = fmt.Errorf("%w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
			}
			return out, err
		},
	}
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
	pane, ok, err := w.targetPane(ctx)
	if !ok || err != nil {
		return err
	}
	_, err = w.run(ctx, w.bin, "cli", "--no-auto-start", "activate-pane-direction", "--pane-id", pane, weztermDirs[dir])
	return err
}

func (w *wezterm) Tab(ctx context.Context, delta int) error {
	pane, ok, err := w.targetPane(ctx)
	if !ok || err != nil {
		return err
	}
	_, err = w.run(ctx, w.bin, "cli", "--no-auto-start", "activate-tab", "--tab-relative", strconv.Itoa(delta), "--pane-id", pane)
	return err
}

// targetPane is the WezTerm pane to move from. ok is false, after a log
// line, when there is nothing to hand off to: no wezterm, or no GUI client
// (herdr attached from another terminal, or over ssh).
func (w *wezterm) targetPane(ctx context.Context) (string, bool, error) {
	if w.bin == "" {
		_, _ = fmt.Fprintln(w.log, "wezterm not found; not handing off")
		return "", false, nil
	}
	if !w.insideHerdr {
		if w.pane == "" {
			_, _ = fmt.Fprintln(w.log, "WEZTERM_PANE not set; not handing off")
			return "", false, nil
		}
		return w.pane, true, nil
	}
	out, err := w.run(ctx, w.bin, "cli", "--no-auto-start", "list-clients", "--format", "json")
	if err != nil {
		return "", false, fmt.Errorf("wezterm list-clients: %w", err)
	}
	pane, ok, err := activeClientPane(out)
	if err != nil {
		return "", false, err
	}
	if !ok {
		_, _ = fmt.Fprintln(w.log, "no wezterm clients; not handing off")
		return "", false, nil
	}
	// herdr attached from Ghostty or over ssh would otherwise move focus in
	// whatever WezTerm window was used last.
	hosts, err := w.paneRunsHerdr(ctx, pane)
	if err != nil {
		return "", false, err
	}
	if !hosts {
		_, _ = fmt.Fprintf(w.log, "wezterm pane %s isn't running herdr; not handing off\n", pane)
		return "", false, nil
	}
	return pane, true, nil
}

// paneRunsHerdr reports whether a herdr client runs on the WezTerm pane's
// tty. It can't tell which herdr server that client is attached to.
func (w *wezterm) paneRunsHerdr(ctx context.Context, pane string) (bool, error) {
	out, err := w.run(ctx, w.bin, "cli", "--no-auto-start", "list", "--format", "json")
	if err != nil {
		return false, fmt.Errorf("wezterm list: %w", err)
	}
	tty, err := paneTTY(out, pane)
	if err != nil || tty == "" {
		return false, err
	}
	// ps takes the tty without /dev/ (ttys000 on macOS, pts/3 on Linux).
	procs, err := w.run(ctx, "ps", "-t", strings.TrimPrefix(tty, "/dev/"), "-o", "comm=")
	if err != nil {
		return false, fmt.Errorf("ps: %w", err)
	}
	for _, comm := range strings.Split(string(procs), "\n") {
		if filepath.Base(strings.TrimSpace(comm)) == "herdr" {
			return true, nil
		}
	}
	return false, nil
}

// paneTTY finds a pane's tty in `wezterm cli list --format json` output;
// empty if the pane is gone or has none (a mux domain).
func paneTTY(list []byte, pane string) (string, error) {
	var panes []struct {
		PaneID  uint64 `json:"pane_id"`
		TTYName string `json:"tty_name"`
	}
	if err := json.Unmarshal(list, &panes); err != nil {
		return "", fmt.Errorf("wezterm list: %w", err)
	}
	for _, p := range panes {
		if strconv.FormatUint(p.PaneID, 10) == pane {
			return p.TTYName, nil
		}
	}
	return "", nil
}

type weztermClient struct {
	IdleTime struct {
		Secs  uint64 `json:"secs"`
		Nanos uint32 `json:"nanos"`
	} `json:"idle_time"`
	FocusedPaneID *uint64 `json:"focused_pane_id"`
}

// activeClientPane picks the focused pane of the most recently active
// client: the one the user just pressed a key in.
func activeClientPane(listClients []byte) (string, bool, error) {
	var clients []weztermClient
	if err := json.Unmarshal(listClients, &clients); err != nil {
		return "", false, fmt.Errorf("wezterm list-clients: %w", err)
	}
	var best *weztermClient
	for i := range clients {
		c := &clients[i]
		if c.FocusedPaneID == nil {
			continue
		}
		if best == nil || c.IdleTime.Secs < best.IdleTime.Secs ||
			c.IdleTime.Secs == best.IdleTime.Secs && c.IdleTime.Nanos < best.IdleTime.Nanos {
			best = c
		}
	}
	if best == nil {
		return "", false, nil
	}
	return strconv.FormatUint(*best.FocusedPaneID, 10), true, nil
}

package herdr

import (
	"context"
	"path"
)

// Process is one foreground process of a pane.
type Process struct {
	PID  uint32
	Name string
	// Argv0, Argv and Cwd are empty when the server couldn't read them.
	Argv0 string
	Argv  []string
	Cwd   string
}

// ProcessInfo describes what runs in a pane.
type ProcessInfo struct {
	PaneID PaneID
	// ShellPID and ForegroundPGID are nil when the pane has no live process.
	ShellPID       *uint32
	ForegroundPGID *uint32
	TTY            string
	Foreground     []Process
}

// Find returns the first foreground process for which match reports true,
// trying its name and then the base name of its argv0, or nil. Both are
// needed: a node script like pi has name "node" and argv0 "pi", while a
// binary run by path has argv0 "/opt/homebrew/bin/nvim".
func (p ProcessInfo) Find(match func(name string) bool) *Process {
	for i := range p.Foreground {
		proc := &p.Foreground[i]
		if match(proc.Name) || (proc.Argv0 != "" && match(path.Base(proc.Argv0))) {
			return proc
		}
	}
	return nil
}

// ProcessInfo reports the foreground processes of a pane.
func (c *Client) ProcessInfo(ctx context.Context, pane PaneID) (ProcessInfo, error) {
	params := struct {
		PaneID PaneID `json:"pane_id,omitempty"`
	}{pane}
	return call[processInfoWire, ProcessInfo](ctx, c, "pane.process_info", "pane_process_info", params, DefaultTimeout)
}

type processInfoWire struct {
	ProcessInfo *struct {
		PaneID         *string       `json:"pane_id"`
		ShellPID       *uint32       `json:"shell_pid"`
		ForegroundPGID *uint32       `json:"foreground_process_group_id"`
		TTY            *string       `json:"tty"`
		Foreground     []processWire `json:"foreground_processes"`
	} `json:"process_info"`
}

type processWire struct {
	PID   *uint32  `json:"pid"`
	Name  *string  `json:"name"`
	Argv0 *string  `json:"argv0"`
	Argv  []string `json:"argv"`
	Cwd   *string  `json:"cwd"`
}

func (w processInfoWire) result(method string) (ProcessInfo, error) {
	pi := w.ProcessInfo
	if pi == nil {
		return ProcessInfo{}, missing(method, "process_info")
	}
	if pi.PaneID == nil {
		return ProcessInfo{}, missing(method, "process_info.pane_id")
	}
	out := ProcessInfo{
		PaneID:         PaneID(*pi.PaneID),
		ShellPID:       pi.ShellPID,
		ForegroundPGID: pi.ForegroundPGID,
		TTY:            deref(pi.TTY),
	}
	for _, p := range pi.Foreground {
		if p.PID == nil {
			return ProcessInfo{}, missing(method, "process_info.foreground_processes[].pid")
		}
		if p.Name == nil {
			return ProcessInfo{}, missing(method, "process_info.foreground_processes[].name")
		}
		out.Foreground = append(out.Foreground, Process{
			PID:   *p.PID,
			Name:  *p.Name,
			Argv0: deref(p.Argv0),
			Argv:  p.Argv,
			Cwd:   deref(p.Cwd),
		})
	}
	return out, nil
}

// SendKeys sends key chords (for example "ctrl+h") to a pane's program,
// bypassing Herdr's own keybindings.
func (c *Client) SendKeys(ctx context.Context, pane PaneID, keys ...string) error {
	params := struct {
		PaneID PaneID   `json:"pane_id"`
		Keys   []string `json:"keys"`
	}{pane, keys}
	if params.Keys == nil {
		params.Keys = []string{} // the schema requires the array
	}
	_, err := call[okWire, struct{}](ctx, c, "pane.send_keys", "ok", params, DefaultTimeout)
	return err
}

// FocusResult reports what FocusDirection did.
type FocusResult struct {
	// Changed is false when focus stayed put; Reason says why.
	Changed bool
	// Reason is empty when the server gave none (normally when Changed).
	Reason        FocusReason
	SourcePaneID  PaneID
	FocusedPaneID PaneID // empty when the server didn't report it
}

// FocusDirection moves focus from pane to its neighbour in dir. At the edge
// of the tab it returns Changed false with Reason FocusNoNeighbor, so one
// call both moves and detects the edge.
func (c *Client) FocusDirection(ctx context.Context, pane PaneID, dir Direction) (FocusResult, error) {
	params := struct {
		PaneID    PaneID    `json:"pane_id,omitempty"`
		Direction Direction `json:"direction"`
	}{pane, dir}
	return call[focusDirectionWire, FocusResult](ctx, c, "pane.focus_direction", "pane_focus_direction", params, DefaultTimeout)
}

type focusDirectionWire struct {
	Focus *struct {
		Changed       *bool        `json:"changed"`
		Reason        *FocusReason `json:"reason"`
		SourcePaneID  *string      `json:"source_pane_id"`
		FocusedPaneID *string      `json:"focused_pane_id"`
		// Required by the schema but unused here; decoding it would cost more
		// than the whole call, so only its presence is checked.
		Layout *rawPresent `json:"layout"`
	} `json:"focus"`
}

func (w focusDirectionWire) result(method string) (FocusResult, error) {
	f := w.Focus
	switch {
	case f == nil:
		return FocusResult{}, missing(method, "focus")
	case f.Changed == nil:
		return FocusResult{}, missing(method, "focus.changed")
	case f.SourcePaneID == nil:
		return FocusResult{}, missing(method, "focus.source_pane_id")
	case f.Layout == nil:
		return FocusResult{}, missing(method, "focus.layout")
	}
	r := FocusResult{
		Changed:       *f.Changed,
		SourcePaneID:  PaneID(*f.SourcePaneID),
		FocusedPaneID: PaneID(deref(f.FocusedPaneID)),
	}
	if f.Reason != nil {
		r.Reason = *f.Reason
	}
	return r, nil
}

// rawPresent decodes any non-null JSON value without keeping it.
type rawPresent struct{}

func (*rawPresent) UnmarshalJSON([]byte) error { return nil }

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

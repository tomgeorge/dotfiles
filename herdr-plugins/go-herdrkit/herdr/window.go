package herdr

import "context"

// WindowTitleReason says what a window-title call did. Values the schema
// adds later pass through unchanged.
type WindowTitleReason string

const (
	WindowTitleSet                WindowTitleReason = "set"
	WindowTitleCleared            WindowTitleReason = "cleared"
	WindowTitleNoForegroundClient WindowTitleReason = "no_foreground_client"
)

// WindowTitleResult reports whether the title of the terminal the
// foreground client runs in changed. No foreground client is not an error;
// check Reason.
type WindowTitleResult struct {
	Changed bool
	Reason  WindowTitleReason
}

// SetWindowTitle sets the title the foreground client writes to its outer
// terminal, overriding ui.window_title until ClearWindowTitle.
func (c *Client) SetWindowTitle(ctx context.Context, title string) (WindowTitleResult, error) {
	params := struct {
		Title string `json:"title"`
	}{title}
	return call[windowTitleWire, WindowTitleResult](ctx, c, "client.window_title.set", "client_window_title", params, DefaultTimeout)
}

// ClearWindowTitle drops a SetWindowTitle override, restoring ui.window_title.
func (c *Client) ClearWindowTitle(ctx context.Context) (WindowTitleResult, error) {
	return call[windowTitleWire, WindowTitleResult](ctx, c, "client.window_title.clear", "client_window_title", struct{}{}, DefaultTimeout)
}

type windowTitleWire struct {
	Changed *bool   `json:"changed"`
	Reason  *string `json:"reason"`
}

func (w windowTitleWire) result(method string) (WindowTitleResult, error) {
	if w.Changed == nil {
		return WindowTitleResult{}, missing(method, "changed")
	}
	if w.Reason == nil {
		return WindowTitleResult{}, missing(method, "reason")
	}
	return WindowTitleResult{Changed: *w.Changed, Reason: WindowTitleReason(*w.Reason)}, nil
}

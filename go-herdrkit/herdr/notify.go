package herdr

import "context"

// ToastPosition is where Herdr draws an in-app toast.
type ToastPosition string

const (
	ToastTopLeft     ToastPosition = "top-left"
	ToastTopRight    ToastPosition = "top-right"
	ToastBottomLeft  ToastPosition = "bottom-left"
	ToastBottomRight ToastPosition = "bottom-right"
)

// Sound is the sound played with a notification.
type Sound string

const (
	SoundNone    Sound = "none"
	SoundDone    Sound = "done"
	SoundRequest Sound = "request"
)

// NotificationReason says why a notification was or wasn't shown. Values the
// schema adds later pass through unchanged.
type NotificationReason string

const (
	NotificationShown              NotificationReason = "shown"
	NotificationDisabled           NotificationReason = "disabled"
	NotificationRateLimited        NotificationReason = "rate_limited"
	NotificationNoForegroundClient NotificationReason = "no_foreground_client"
	NotificationBusy               NotificationReason = "busy"
)

// Notification is a toast request. Zero-valued optional fields are omitted
// so the server applies its own defaults.
type Notification struct {
	Title    string        `json:"title"`
	Body     string        `json:"body,omitempty"`
	Position ToastPosition `json:"position,omitempty"`
	Sound    Sound         `json:"sound,omitempty"`
}

// NotificationResult reports whether the server displayed the notification.
// A notification that isn't shown is not an error; check Shown and Reason.
type NotificationResult struct {
	Shown  bool
	Reason NotificationReason
}

// ShowNotification asks Herdr to display a toast.
func (c *Client) ShowNotification(ctx context.Context, n Notification) (NotificationResult, error) {
	return call[notificationWire, NotificationResult](ctx, c, "notification.show", "notification_show", n, DefaultTimeout)
}

type notificationWire struct {
	Shown  *bool   `json:"shown"`
	Reason *string `json:"reason"`
}

func (w notificationWire) result(method string) (NotificationResult, error) {
	if w.Shown == nil {
		return NotificationResult{}, missing(method, "shown")
	}
	if w.Reason == nil {
		return NotificationResult{}, missing(method, "reason")
	}
	return NotificationResult{Shown: *w.Shown, Reason: NotificationReason(*w.Reason)}, nil
}

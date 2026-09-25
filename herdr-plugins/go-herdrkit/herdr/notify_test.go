package herdr

import (
	"context"
	"errors"
	"testing"
)

func TestShowNotificationRequest(t *testing.T) {
	for name, tt := range map[string]struct {
		in   Notification
		want string
	}{
		"title only": {Notification{Title: "hi"}, `{"title":"hi"}`},
		"everything": {
			Notification{Title: "hi", Body: "there", Position: ToastTopRight, Sound: SoundNone},
			`{"title":"hi","body":"there","position":"top-right","sound":"none"}`,
		},
	} {
		t.Run(name, func(t *testing.T) {
			c, got := fakeServer(t, answer(`{"type":"notification_show","shown":true,"reason":"shown"}`))
			if _, err := c.ShowNotification(context.Background(), tt.in); err != nil {
				t.Fatal(err)
			}
			req := <-got
			if req.Method != "notification.show" {
				t.Errorf("method = %q", req.Method)
			}
			if string(req.Params) != tt.want {
				t.Errorf("params = %s, want %s", req.Params, tt.want)
			}
		})
	}
}

func TestShowNotificationResult(t *testing.T) {
	c, _ := fakeServer(t, answer(`{"type":"notification_show","shown":false,"reason":"no_foreground_client"}`))
	r, err := c.ShowNotification(context.Background(), Notification{Title: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	if r.Shown || r.Reason != NotificationNoForegroundClient {
		t.Errorf("result = %+v", r)
	}
}

func TestShowNotificationRejects(t *testing.T) {
	for name, tt := range map[string]struct {
		result string
		want   error
	}{
		"missing shown":  {`{"type":"notification_show","reason":"shown"}`, ErrMissingField},
		"missing reason": {`{"type":"notification_show","shown":true}`, ErrMissingField},
		"wrong tag":      {`{"type":"pong","version":"v","protocol":22}`, ErrWrongResult},
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(tt.result))
			if _, err := c.ShowNotification(context.Background(), Notification{Title: "hi"}); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

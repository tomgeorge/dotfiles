package herdr

import (
	"context"
	"errors"
	"testing"
)

func TestSetWindowTitle(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"client_window_title","changed":true,"reason":"set"}`))
	r, err := c.SetWindowTitle(context.Background(), "hi")
	if err != nil {
		t.Fatal(err)
	}
	if !r.Changed || r.Reason != WindowTitleSet {
		t.Errorf("result = %+v", r)
	}
	req := <-got
	if req.Method != "client.window_title.set" || string(req.Params) != `{"title":"hi"}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
}

func TestClearWindowTitle(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"client_window_title","changed":false,"reason":"no_foreground_client"}`))
	r, err := c.ClearWindowTitle(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.Changed || r.Reason != WindowTitleNoForegroundClient {
		t.Errorf("result = %+v", r)
	}
	req := <-got
	if req.Method != "client.window_title.clear" || string(req.Params) != `{}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
}

func TestWindowTitleRejects(t *testing.T) {
	for name, tt := range map[string]struct {
		result string
		want   error
	}{
		"missing changed": {`{"type":"client_window_title","reason":"set"}`, ErrMissingField},
		"missing reason":  {`{"type":"client_window_title","changed":true}`, ErrMissingField},
		"wrong tag":       {`{"type":"pong","version":"v","protocol":22}`, ErrWrongResult},
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(tt.result))
			if _, err := c.SetWindowTitle(context.Background(), "hi"); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

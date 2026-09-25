package herdr

import (
	"bytes"
	"context"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

const pongOK = `{"type":"pong","version":"0.0.0-test","protocol":22,"capabilities":{"live_handoff":true,"health_check":true,"endpoint_protocol_generation":3}}`

func TestPingRequestShape(t *testing.T) {
	c, got := fakeServer(t, answer(pongOK))
	if _, err := c.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	req := <-got
	if req.Method != "ping" {
		t.Errorf("method = %q, want ping", req.Method)
	}
	if string(req.Params) != "{}" {
		t.Errorf("params = %s, want {} (schema: PingParams is an object)", req.Params)
	}
	if !regexp.MustCompile(`^\d+-\d+$`).MatchString(req.ID) {
		t.Errorf("id = %q, want <pid>-<n>", req.ID)
	}
	if bytes.Count(req.raw, []byte("\n")) != 1 || !bytes.HasSuffix(req.raw, []byte("\n")) {
		t.Errorf("request must be exactly one newline-terminated line: %q", req.raw)
	}
}

func TestPingIDsAreUnique(t *testing.T) {
	var ids []string
	for range 2 {
		c, got := fakeServer(t, answer(pongOK))
		if _, err := c.Ping(context.Background()); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, (<-got).ID)
	}
	if ids[0] == ids[1] {
		t.Errorf("ids repeated: %v", ids)
	}
}

func TestPingDecodes(t *testing.T) {
	c, _ := fakeServer(t, answer(pongOK))
	p, err := c.Ping(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if p.Version != "0.0.0-test" || p.Protocol != 22 {
		t.Errorf("pong = %+v", p)
	}
	caps := p.Capabilities
	if caps == nil || !caps.LiveHandoff || !caps.HealthCheck || caps.SurfaceInterest ||
		caps.EndpointGeneration == nil || *caps.EndpointGeneration != 3 {
		t.Errorf("capabilities = %+v", caps)
	}
}

func TestPingTolerates(t *testing.T) {
	for name, result := range map[string]string{
		"no capabilities":   `{"type":"pong","version":"v","protocol":22}`,
		"null capabilities": `{"type":"pong","version":"v","protocol":22,"capabilities":null}`,
		"unknown fields":    `{"type":"pong","version":"v","protocol":22,"shiny_new":1,"capabilities":{"live_handoff":false,"also_new":true}}`,
		"other protocol":    `{"type":"pong","version":"v","protocol":99}`,
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(result))
			if _, err := c.Ping(context.Background()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPingRejects(t *testing.T) {
	tests := []struct {
		name    string
		respond func(sent) []byte
		want    error
		msg     string
	}{
		{"missing version", answer(`{"type":"pong","protocol":22}`), ErrMissingField, "version"},
		{"null version", answer(`{"type":"pong","version":null,"protocol":22}`), ErrMissingField, "version"},
		{"missing protocol", answer(`{"type":"pong","version":"v"}`), ErrMissingField, "protocol"},
		{"missing live_handoff", answer(`{"type":"pong","version":"v","protocol":22,"capabilities":{}}`), ErrMissingField, "live_handoff"},
		{"wrong tag", answer(`{"type":"ok"}`), ErrWrongResult, `"ok"`},
		{"no tag", answer(`{"version":"v","protocol":22}`), ErrWrongResult, `""`},
		{"protocol wrong type", answer(`{"type":"pong","version":"v","protocol":"22"}`), ErrProtocol, ""},
		{"id mismatch", func(sent) []byte {
			return []byte(`{"id":"someone-else","result":` + pongOK + "}\n")
		}, ErrIDMismatch, "someone-else"},
		{"no id", func(sent) []byte {
			return []byte(`{"result":` + pongOK + "}\n")
		}, ErrIDMismatch, "<none>"},
		{"neither result nor error", func(r sent) []byte {
			return []byte(`{"id":` + quote(r.ID) + "}\n")
		}, ErrProtocol, "neither"},
		{"not json", func(sent) []byte { return []byte("hello\n") }, ErrProtocol, ""},
		{"closed without reply", func(sent) []byte { return []byte{} }, ErrProtocol, "without a reply"},
		{"truncated", func(r sent) []byte {
			return []byte(`{"id":` + quote(r.ID) + `,"result":` + pongOK + "}") // no newline
		}, ErrProtocol, "truncated"},
		{"oversized", func(sent) []byte {
			return append(bytes.Repeat([]byte("x"), MaxFrameBytes+1), '\n')
		}, ErrFrameTooLarge, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := fakeServer(t, tt.respond)
			_, err := c.Ping(context.Background())
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			if !strings.Contains(err.Error(), tt.msg) {
				t.Errorf("err = %q, want it to mention %q", err, tt.msg)
			}
			if !strings.HasPrefix(err.Error(), "ping: ") {
				t.Errorf("err = %q, want it to name the method", err)
			}
		})
	}
}

func TestFrameAtLimitIsAccepted(t *testing.T) {
	// A valid reply padded to exactly MaxFrameBytes via an ignored field.
	c, _ := fakeServer(t, func(r sent) []byte {
		head := `{"id":` + quote(r.ID) + `,"result":` + pongOK + `,"pad":"`
		tail := `"}`
		pad := strings.Repeat("x", MaxFrameBytes-len(head)-len(tail))
		return []byte(head + pad + tail + "\n")
	})
	if _, err := c.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestPingAPIError(t *testing.T) {
	c, _ := fakeServer(t, func(r sent) []byte {
		return []byte(`{"id":` + quote(r.ID) + `,"error":{"code":"bad_request","message":"nope"}}` + "\n")
	})
	_, err := c.Ping(context.Background())
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v, want *APIError", err)
	}
	if apiErr.Method != "ping" || apiErr.Code != "bad_request" || apiErr.Message != "nope" {
		t.Errorf("apiErr = %+v", apiErr)
	}
}

func TestPingHonoursContextDeadline(t *testing.T) {
	c, _ := fakeServer(t, func(sent) []byte { return nil }) // never answers
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := c.Ping(ctx)
	if !errors.Is(err, os.ErrDeadlineExceeded) && !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want a deadline error", err)
	}
	if el := time.Since(start); el > time.Second {
		t.Errorf("took %v; the ctx deadline should beat DefaultTimeout", el)
	}
}

func TestPingDefaultTimeout(t *testing.T) {
	if testing.Short() {
		t.Skip("waits DefaultTimeout")
	}
	c, _ := fakeServer(t, func(sent) []byte { return nil })
	start := time.Now()
	_, err := c.Ping(context.Background())
	if !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatalf("err = %v, want os.ErrDeadlineExceeded", err)
	}
	if el := time.Since(start); el < DefaultTimeout || el > DefaultTimeout+time.Second {
		t.Errorf("took %v, want ~%v", el, DefaultTimeout)
	}
}

func TestPingCancel(t *testing.T) {
	c, _ := fakeServer(t, func(sent) []byte { return nil })
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	_, err := c.Ping(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestPingNoServer(t *testing.T) {
	c := New("/nonexistent/herdr.sock")
	if _, err := c.Ping(context.Background()); err == nil || !strings.Contains(err.Error(), "connect") {
		t.Fatalf("err = %v, want a connect error", err)
	}
}

func TestFromEnv(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "")
	if _, err := FromEnv(); !errors.Is(err, ErrNoSocket) {
		t.Errorf("empty: err = %v, want ErrNoSocket", err)
	}
	t.Setenv("HERDR_SOCKET_PATH", "/tmp/x.sock")
	c, err := FromEnv()
	if err != nil || c.SocketPath() != "/tmp/x.sock" {
		t.Errorf("set: c = %v, err = %v", c, err)
	}
}

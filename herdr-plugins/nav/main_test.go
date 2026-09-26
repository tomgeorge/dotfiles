package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

func TestRunArgs(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "")
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "")
	for name, args := range map[string][]string{
		"none":          nil,
		"not pane":      {"tab", "next"},
		"bad direction": {"pane", "sideways"},
		"extra":         {"pane", "left", "x"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := run(args, io.Discard); err == nil {
				t.Error("want usage error")
			}
		})
	}
}

// Outside herdr nvim hands off to WezTerm itself (a user var), never here.
func TestRunOutsideHerdr(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "")
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "")
	if err := run([]string{"pane", "right"}, io.Discard); !errors.Is(err, herdr.ErrNoSocket) {
		t.Errorf("err = %v, want ErrNoSocket", err)
	}
}

func TestRunUnknownAction(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "/nonexistent")
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "sideways")
	if err := run(nil, io.Discard); err == nil {
		t.Error("want error")
	}
}

// fakeHerdr answers every request on a unix socket and records the methods
// called. nvim is always in front; focus always moves.
func fakeHerdr(t *testing.T) (socket string, methods func() []string) {
	t.Helper()
	dir, err := os.MkdirTemp("", "nv") // short: unix socket paths are capped
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket = filepath.Join(dir, "s")
	ln, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var got []string
	done := make(chan struct{})
	t.Cleanup(func() { _ = ln.Close(); <-done })
	go func() {
		defer close(done)
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			var req struct{ ID, Method string }
			if err := json.NewDecoder(conn).Decode(&req); err != nil {
				_ = conn.Close()
				continue
			}
			mu.Lock()
			got = append(got, req.Method)
			mu.Unlock()
			result := map[string]string{
				"pane.process_info":    `{"type":"pane_process_info","process_info":{"pane_id":"p1","foreground_processes":[{"pid":1,"name":"nvim"}]}}`,
				"pane.focus_direction": `{"type":"pane_focus_direction","focus":{"changed":true,"source_pane_id":"p1","layout":{}}}`,
				"pane.send_keys":       `{"type":"ok"}`,
			}[req.Method]
			_, _ = fmt.Fprintf(conn, `{"id":%q,"result":%s}`+"\n", req.ID, result)
			_ = conn.Close()
		}
	}()
	return socket, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), got...)
	}
}

// nvim at its edge must move herdr focus even when it inherited a plugin
// action id; forwarding ctrl+h back to nvim would loop forever.
func TestRunArgsBeatInheritedActionID(t *testing.T) {
	socket, methods := fakeHerdr(t)
	t.Setenv("HERDR_SOCKET_PATH", socket)
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "left")
	t.Setenv("HERDR_PANE_ID", "p1")
	t.Setenv("HERDR_NAV_OUTER_LOG", filepath.Join(t.TempDir(), "outer.log"))
	if err := run([]string{"pane", "left"}, io.Discard); err != nil {
		t.Fatal(err)
	}
	// Checks focus is still on nvim's pane, then moves; no send_keys.
	if got, want := methods(), []string{"pane.process_info", "pane.focus_direction"}; !reflect.DeepEqual(got, want) {
		t.Errorf("calls = %q, want %q", got, want)
	}
}

// The same environment without arguments is a herdr keypress: nvim gets it.
func TestRunActionForwardsToNvim(t *testing.T) {
	socket, methods := fakeHerdr(t)
	t.Setenv("HERDR_SOCKET_PATH", socket)
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "left")
	t.Setenv("HERDR_PANE_ID", "p1")
	if err := run(nil, io.Discard); err != nil {
		t.Fatal(err)
	}
	if got := methods(); !reflect.DeepEqual(got, []string{"pane.process_info", "pane.send_keys"}) {
		t.Errorf("calls = %q, want process_info then send_keys", got)
	}
}

// Runs against one server take turns; a run that can't get the lock in
// lockWait is dropped rather than run late.
func TestLockNav(t *testing.T) {
	socket := filepath.Join(t.TempDir(), "s")
	lock, err := lockNav(context.Background(), socket, io.Discard)
	if err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	if _, err := lockNav(context.Background(), socket, io.Discard); !errors.Is(err, errBusy) {
		t.Errorf("held lock: err = %v, want errBusy", err)
	}
	if waited := time.Since(start); waited < lockWait-10*time.Millisecond || waited > lockWait+200*time.Millisecond {
		t.Errorf("waited %v, want about %v", waited, lockWait)
	}

	lock.unlock()
	start = time.Now()
	lock2, err := lockNav(context.Background(), socket, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	lock2.unlock()
	// Generous: this is "not waiting for lockWait", not a latency check.
	if waited := time.Since(start); waited > lockWait/2 {
		t.Errorf("released lock still blocked (%v)", waited)
	}
}

// The last move survives from one run to the next, and can be cleared.
func TestLockNavRecordsMoves(t *testing.T) {
	socket := filepath.Join(t.TempDir(), "s")
	take := func() *navLock {
		t.Helper()
		l, err := lockNav(context.Background(), socket, io.Discard)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	l := take()
	if got := l.lastMove(); got != "" {
		t.Errorf("fresh lastMove = %q", got)
	}
	l.recordMove("w1:p12")
	l.recordMove("w1:p3") // shorter: must not leave "w1:p32"
	l.unlock()

	l = take()
	if got := l.lastMove(); got != "w1:p3" {
		t.Errorf("lastMove = %q, want w1:p3", got)
	}
	l.recordMove("")
	l.unlock()

	l = take()
	defer l.unlock()
	if got := l.lastMove(); got != "" {
		t.Errorf("cleared lastMove = %q", got)
	}
}

// No lock file (unwritable dir): run anyway rather than lose every key.
func TestLockNavUnusable(t *testing.T) {
	lock, err := lockNav(context.Background(), "/nonexistent/dir/s", io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	lock.recordMove("p1")
	if got := lock.lastMove(); got != "" {
		t.Errorf("unlocked lastMove = %q", got)
	}
	lock.unlock()
}

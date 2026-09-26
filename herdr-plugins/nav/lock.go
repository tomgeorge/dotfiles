package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"syscall"
	"time"
)

// lockNav serialises herdr-nav invocations against one herdr server, so a
// burst of keys (key repeat) moves one pane per key: each run reads the
// server's focus only after the previous run has changed it. It gives up
// when ctx expires, and on any error runs unlocked rather than eating the
// key; the returned func releases the lock.
func lockNav(ctx context.Context, socket string, log io.Writer) func() {
	f, err := os.OpenFile(socket+".tg-nav.lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		_, _ = fmt.Fprintf(log, "lock: %v; running unlocked\n", err)
		return func() {}
	}
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			// Closing the file releases the lock.
			return func() { _ = f.Close() }
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			_, _ = fmt.Fprintf(log, "lock: %v; running unlocked\n", err)
			_ = f.Close()
			return func() {}
		}
		select {
		case <-ctx.Done():
			_, _ = fmt.Fprintln(log, "lock: timed out; running unlocked")
			_ = f.Close()
			return func() {}
		case <-time.After(2 * time.Millisecond):
		}
	}
}

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

// errBusy means another herdr-nav run held the lock for the whole wait.
var errBusy = errors.New("another herdr-nav run is still going; dropped this key")

// lockWait bounds the wait for the lock, well inside the run's overall
// budget: a queued run that starts late would act on a stale screen, and
// one left with no time can only fail.
const lockWait = 250 * time.Millisecond

// lockNav serialises herdr-nav invocations against one herdr server, so a
// burst of keys (key repeat) moves one pane per key: each run reads the
// server's focus only after the previous run has changed it.
//
// If the lock stays held past lockWait it returns errBusy: dropping one
// repeat of a key is invisible, a move out of order isn't. If the lock
// can't be used at all (no lock file) it runs unlocked. The returned func
// releases the lock.
func lockNav(ctx context.Context, socket string, log io.Writer) (func(), error) {
	f, err := os.OpenFile(socket+".tg-nav.lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		_, _ = fmt.Fprintf(log, "lock: %v; running unlocked\n", err)
		return func() {}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, lockWait)
	defer cancel()
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			// Closing the file releases the lock.
			return func() { _ = f.Close() }, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			_, _ = fmt.Fprintf(log, "lock: %v; running unlocked\n", err)
			_ = f.Close()
			return func() {}, nil
		}
		select {
		case <-ctx.Done():
			_ = f.Close()
			return nil, errBusy
		case <-time.After(2 * time.Millisecond):
		}
	}
}

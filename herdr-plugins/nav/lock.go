package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// errBusy means another herdr-nav run held the lock for the whole wait.
var errBusy = errors.New("another herdr-nav run is still going; dropped this key")

// lockWait bounds the wait for the lock, well inside the run's overall
// budget: a queued run that starts late would act on a stale screen, and
// one left with no time can only fail.
const lockWait = 250 * time.Millisecond

// navLock serialises herdr-nav runs against one herdr server, so a burst of
// keys (key repeat) moves one pane per key: each run reads the server's
// focus only after the previous run has changed it. The kernel drops a flock
// when its holder exits, so a crash can't leave it held.
//
// The file also records the pane nav last moved focus to (see lastMove).
//
// Waiters are not served in keypress order: herdr starts one process per
// key and gives them no sequence number (NAV_PLAN.md, "Known limitations").
type navLock struct {
	f *os.File // nil when running unlocked
}

// lockNav takes the lock for the server at socket, waiting up to lockWait
// (or until ctx ends) before giving up with errBusy: dropping one repeat of
// a key is invisible, a move out of order isn't.
//
// If the lock can't be used at all (no lock file) it logs that and returns
// a lock that does nothing: bursts may then land wrong, but losing every
// key would be worse.
func lockNav(ctx context.Context, socket string, log io.Writer) (*navLock, error) {
	f, err := os.OpenFile(socket+".tg-nav.lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		_, _ = fmt.Fprintf(log, "lock: %v; running unlocked\n", err)
		return &navLock{}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, lockWait)
	defer cancel()
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return &navLock{f: f}, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			_, _ = fmt.Fprintf(log, "lock: %v; running unlocked\n", err)
			_ = f.Close()
			return &navLock{}, nil
		}
		select {
		case <-ctx.Done():
			_ = f.Close()
			return nil, errBusy
		case <-time.After(time.Millisecond):
		}
	}
}

// unlock releases the lock; closing the file drops the flock.
func (l *navLock) unlock() {
	if l.f != nil {
		_ = l.f.Close()
	}
}

// lastMove is the pane nav last moved herdr focus to, or empty when its last
// action didn't leave focus on a known pane (a tab move, a handoff).
func (l *navLock) lastMove() herdr.PaneID {
	if l.f == nil {
		return ""
	}
	b, err := io.ReadAll(io.NewSectionReader(l.f, 0, 256))
	if err != nil {
		return ""
	}
	return herdr.PaneID(strings.TrimSpace(string(b)))
}

// recordMove sets lastMove. Errors are ignored: a lost record only makes a
// later nvim edge call drop its key rather than continue (see edge).
func (l *navLock) recordMove(pane herdr.PaneID) {
	if l.f == nil {
		return
	}
	if err := l.f.Truncate(0); err != nil {
		return
	}
	_, _ = l.f.WriteAt([]byte(pane), 0)
}

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// fakeTitles is herdr's window title: it records calls, and when a pane is
// set it "shows" the title there, after late lists, as a client that draws
// on its next frame would.
type fakeTitles struct {
	calls  []string
	reason herdr.WindowTitleReason // for set; "set" when empty
	err    error
	title  string
}

func (f *fakeTitles) SetWindowTitle(_ context.Context, title string) (herdr.WindowTitleResult, error) {
	f.calls = append(f.calls, "set")
	if f.err != nil {
		return herdr.WindowTitleResult{}, f.err
	}
	r := herdr.WindowTitleResult{Changed: true, Reason: herdr.WindowTitleSet}
	if f.reason != "" {
		r = herdr.WindowTitleResult{Reason: f.reason}
	} else {
		f.title = title
	}
	return r, nil
}

func (f *fakeTitles) ClearWindowTitle(context.Context) (herdr.WindowTitleResult, error) {
	f.calls = append(f.calls, "clear")
	f.title = ""
	return herdr.WindowTitleResult{Changed: true, Reason: herdr.WindowTitleCleared}, nil
}

// terminal fakes an outer terminal with panes 3 and 7. host, when set, is
// the pane herdr's client runs in: it shows the herdr title from the late'th
// list on. Pane 3 always shows a decoy: another herdr, titled like one.
type terminal struct {
	titles *fakeTitles
	host   string
	late   int
	lists  int
	err    error
}

func (term *terminal) list(context.Context) ([]termPane, error) {
	term.lists++
	if term.err != nil {
		return nil, term.err
	}
	seven := "fish"
	if term.host == "7" && term.titles.title != "" && term.lists > term.late {
		seven = term.titles.title
	}
	return []termPane{{ID: "3", Title: "herdr-nav 1.2"}, {ID: "7", Title: seven}}, nil
}

func TestFindHost(t *testing.T) {
	for name, tt := range map[string]struct {
		titles    fakeTitles
		term      terminal
		want      string
		wantOK    bool
		wantErr   bool
		wantCalls []string
	}{
		"finds the pane with the title":      {term: terminal{host: "7"}, want: "7", wantOK: true, wantCalls: []string{"set", "clear"}},
		"waits for the client to draw it":    {term: terminal{host: "7", late: 3}, want: "7", wantOK: true, wantCalls: []string{"set", "clear"}},
		"client in another terminal: no":     {term: terminal{}, wantCalls: []string{"set", "clear"}},
		"no foreground client: no":           {titles: fakeTitles{reason: herdr.WindowTitleNoForegroundClient}, term: terminal{host: "7"}, wantCalls: []string{"set", "clear"}},
		"set fails: error, nothing to clear": {titles: fakeTitles{err: errors.New("boom")}, term: terminal{host: "7"}, wantErr: true, wantCalls: []string{"set"}},
		"list fails: error, title cleared":   {term: terminal{host: "7", err: errors.New("boom")}, wantErr: true, wantCalls: []string{"set", "clear"}},
	} {
		t.Run(name, func(t *testing.T) {
			titles, term := tt.titles, tt.term
			term.titles = &titles
			got, ok, err := findHost(context.Background(), &titles, term.list, io.Discard)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, want error %v", err, tt.wantErr)
			}
			if got != tt.want || ok != tt.wantOK {
				t.Errorf("= %q, %v; want %q, %v", got, ok, tt.want, tt.wantOK)
			}
			if !reflect.DeepEqual(titles.calls, tt.wantCalls) {
				t.Errorf("title calls = %q, want %q", titles.calls, tt.wantCalls)
			}
		})
	}
}

// With no pane ever showing the title it gives up after hostWait.
func TestFindHostGivesUp(t *testing.T) {
	titles := &fakeTitles{}
	term := &terminal{titles: titles}
	start := time.Now()
	if _, ok, err := findHost(context.Background(), titles, term.list, io.Discard); ok || err != nil {
		t.Fatalf("ok %v, err %v", ok, err)
	}
	if waited := time.Since(start); waited < hostWait || waited > hostWait+time.Second {
		t.Errorf("waited %v, want about %v", waited, hostWait)
	}
}

// recorder fakes `wezterm cli`: it logs each call and answers list with
// panes 3 and 7, 7 showing whatever title herdr set.
type recorder struct {
	calls  []string
	titles *fakeTitles
	err    error
}

func (r *recorder) run(_ context.Context, args ...string) ([]byte, error) {
	r.calls = append(r.calls, strings.Join(args, " "))
	if args[0] == "list" {
		return []byte(`[{"pane_id":3,"title":"fish"},{"pane_id":7,"title":"` + r.titles.title + `"}]`), r.err
	}
	return nil, r.err
}

func TestWezterm(t *testing.T) {
	const list = "list --format json"
	for name, tt := range map[string]struct {
		bin  string
		do   func(context.Context, *wezterm) error
		want []string
	}{
		"pane": {"wz", func(ctx context.Context, w *wezterm) error { return w.PaneDirection(ctx, herdr.Left) },
			[]string{list, "activate-pane-direction --pane-id 7 Left"}},
		"tab": {"wz", func(ctx context.Context, w *wezterm) error { return w.Tab(ctx, -1) },
			[]string{list, "activate-tab --tab-relative -1 --pane-id 7"}},
		"no wezterm does nothing": {"", func(ctx context.Context, w *wezterm) error { return w.PaneDirection(ctx, herdr.Up) },
			nil},
	} {
		t.Run(name, func(t *testing.T) {
			titles := &fakeTitles{}
			rec := &recorder{titles: titles}
			w := &wezterm{bin: tt.bin, titles: titles, log: io.Discard, run: rec.run}
			if err := tt.do(context.Background(), w); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(rec.calls, tt.want) {
				t.Errorf("calls = %q\nwant    %q", rec.calls, tt.want)
			}
		})
	}
}

func TestWeztermError(t *testing.T) {
	titles := &fakeTitles{}
	rec := &recorder{titles: titles, err: errors.New("no gui")}
	w := &wezterm{bin: "wz", titles: titles, log: io.Discard, run: rec.run}
	if err := w.PaneDirection(context.Background(), herdr.Left); err == nil {
		t.Fatal("want error")
	}
}

// newWezterm's commands start with the flags every call needs.
func TestNewWeztermArgs(t *testing.T) {
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args")
	bin := filepath.Join(dir, "wezterm")
	script := "#!/bin/sh\necho \"$@\" > " + argsFile + "\necho \"${WEZTERM_UNIX_SOCKET-unset}\" >> " + argsFile + "\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("WEZTERM_UNIX_SOCKET", "/gone")
	w := newWezterm(&fakeTitles{}, io.Discard)
	w.bin = bin
	if _, err := w.run(context.Background(), "list"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(b), "cli --no-auto-start list\nunset\n"; got != want {
		t.Errorf("ran %q, want %q", got, want)
	}
}

// A child that leaves the output pipe open doesn't hold command past ctx.
func TestCommandWaitDelay(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := runCmd(ctx, nil, "sh", "-c", "sleep 5 & sleep 5")
	if err == nil {
		t.Fatal("want error")
	}
	if waited := time.Since(start); waited > 2*time.Second {
		t.Errorf("returned after %v", waited)
	}
}

func TestLogOuter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outer.log")
	o := &logOuter{path: path}
	ctx := context.Background()
	for _, err := range []error{o.PaneDirection(ctx, herdr.Left), o.Tab(ctx, 1), o.Tab(ctx, -1)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(b), "pane left\ntab +1\ntab -1\n"; got != want {
		t.Errorf("log = %q, want %q", got, want)
	}
}

// With a terminal to search, the log names the host pane, and skips the
// handoff when there's none.
func TestLogOuterFindsHost(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outer.log")
	titles := &fakeTitles{}
	term := &terminal{titles: titles, host: "7"}
	o := &logOuter{path: path, titles: titles, list: term.list, log: io.Discard}
	if err := o.PaneDirection(context.Background(), herdr.Left); err != nil {
		t.Fatal(err)
	}
	term.host = ""
	if err := o.Tab(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(b), "pane left 7\n"; got != want {
		t.Errorf("log = %q, want %q", got, want)
	}
}

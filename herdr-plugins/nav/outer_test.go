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

	"github.com/tomgeorge/go-herdrkit/herdr"
)

func TestActiveClientPane(t *testing.T) {
	for name, tt := range map[string]struct {
		json   string
		want   string
		wantOK bool
	}{
		"one":       {`[{"idle_time":{"secs":9,"nanos":0},"focused_pane_id":9}]`, "9", true},
		"none":      {`[]`, "", false},
		"no pane":   {`[{"idle_time":{"secs":0,"nanos":0}}]`, "", false},
		"most idle": {`[{"idle_time":{"secs":5,"nanos":0},"focused_pane_id":1},{"idle_time":{"secs":0,"nanos":9},"focused_pane_id":2},{"idle_time":{"secs":0,"nanos":10},"focused_pane_id":3}]`, "2", true},
		"pane 0":    {`[{"idle_time":{"secs":1,"nanos":0},"focused_pane_id":0}]`, "0", true},
	} {
		t.Run(name, func(t *testing.T) {
			got, ok, err := activeClientPane([]byte(tt.json))
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want || ok != tt.wantOK {
				t.Errorf("= %q, %v; want %q, %v", got, ok, tt.want, tt.wantOK)
			}
		})
	}
	if _, _, err := activeClientPane([]byte("not json")); err == nil {
		t.Error("bad json: want error")
	}
}

// recorder fakes wezterm: it logs each command and answers list-clients.
type recorder struct {
	calls   []string
	clients string
	err     error
}

func (r *recorder) run(_ context.Context, bin string, args ...string) ([]byte, error) {
	r.calls = append(r.calls, bin+" "+strings.Join(args, " "))
	if args[1] == "list-clients" {
		return []byte(r.clients), r.err
	}
	return nil, r.err
}

func TestWezterm(t *testing.T) {
	const clients = `[{"idle_time":{"secs":0,"nanos":1},"focused_pane_id":7}]`
	for name, tt := range map[string]struct {
		w    wezterm
		rec  recorder
		do   func(context.Context, *wezterm) error
		want []string
	}{
		"inside herdr asks for the active pane": {
			wezterm{bin: "wz", pane: "99", insideHerdr: true}, recorder{clients: clients},
			func(ctx context.Context, w *wezterm) error { return w.PaneDirection(ctx, herdr.Left) },
			[]string{"wz cli list-clients --format json", "wz cli activate-pane-direction --pane-id 7 Left"},
		},
		"outside herdr trusts WEZTERM_PANE": {
			wezterm{bin: "wz", pane: "3"}, recorder{},
			func(ctx context.Context, w *wezterm) error { return w.PaneDirection(ctx, herdr.Down) },
			[]string{"wz cli activate-pane-direction --pane-id 3 Down"},
		},
		"tab": {
			wezterm{bin: "wz", insideHerdr: true}, recorder{clients: clients},
			func(ctx context.Context, w *wezterm) error { return w.Tab(ctx, -1) },
			[]string{"wz cli list-clients --format json", "wz cli activate-tab --tab-relative -1 --pane-id 7"},
		},
		"no clients does nothing": {
			wezterm{bin: "wz", insideHerdr: true}, recorder{clients: `[]`},
			func(ctx context.Context, w *wezterm) error { return w.Tab(ctx, 1) },
			[]string{"wz cli list-clients --format json"},
		},
		"no wezterm does nothing": {
			wezterm{insideHerdr: true}, recorder{},
			func(ctx context.Context, w *wezterm) error { return w.PaneDirection(ctx, herdr.Up) },
			nil,
		},
		"outside herdr without WEZTERM_PANE does nothing": {
			wezterm{bin: "wz"}, recorder{},
			func(ctx context.Context, w *wezterm) error { return w.PaneDirection(ctx, herdr.Up) },
			nil,
		},
	} {
		t.Run(name, func(t *testing.T) {
			w, rec := tt.w, tt.rec
			w.run, w.log = rec.run, io.Discard
			if err := tt.do(context.Background(), &w); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(rec.calls, tt.want) {
				t.Errorf("calls = %q\nwant    %q", rec.calls, tt.want)
			}
		})
	}
}

func TestWeztermError(t *testing.T) {
	rec := &recorder{err: errors.New("no gui")}
	w := wezterm{bin: "wz", insideHerdr: true, run: rec.run, log: io.Discard}
	if err := w.PaneDirection(context.Background(), herdr.Left); err == nil {
		t.Fatal("want error")
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

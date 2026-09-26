package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"testing"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// fakeAPI records calls as strings and answers from its fields.
type fakeAPI struct {
	calls    []string
	info     herdr.ProcessInfo
	infoErr  error
	focus    herdr.FocusResult
	focusErr error
	tabs     []herdr.TabInfo
}

func (f *fakeAPI) ProcessInfo(_ context.Context, pane herdr.PaneID) (herdr.ProcessInfo, error) {
	f.calls = append(f.calls, "process_info "+string(pane))
	return f.info, f.infoErr
}

func (f *fakeAPI) SendKeys(_ context.Context, pane herdr.PaneID, keys ...string) error {
	f.calls = append(f.calls, "send_keys "+string(pane)+" "+strings.Join(keys, " "))
	return nil
}

func (f *fakeAPI) FocusDirection(_ context.Context, pane herdr.PaneID, dir herdr.Direction) (herdr.FocusResult, error) {
	f.calls = append(f.calls, "focus_direction "+string(pane)+" "+string(dir))
	return f.focus, f.focusErr
}

func (f *fakeAPI) ListTabs(_ context.Context, ws herdr.WorkspaceID) ([]herdr.TabInfo, error) {
	f.calls = append(f.calls, "list_tabs "+string(ws))
	return f.tabs, nil
}

func (f *fakeAPI) FocusTab(_ context.Context, tab herdr.TabID) (herdr.TabInfo, error) {
	f.calls = append(f.calls, "focus_tab "+string(tab))
	return herdr.TabInfo{TabID: tab, Focused: true}, nil
}

type fakeOuter struct{ calls []string }

func (o *fakeOuter) PaneDirection(_ context.Context, dir herdr.Direction) error {
	o.calls = append(o.calls, "pane "+string(dir))
	return nil
}

func (o *fakeOuter) Tab(_ context.Context, delta int) error {
	o.calls = append(o.calls, fmt.Sprintf("tab %+d", delta))
	return nil
}

func running(names ...string) herdr.ProcessInfo {
	var info herdr.ProcessInfo
	for i, n := range names {
		info.Foreground = append(info.Foreground, herdr.Process{PID: uint32(i + 1), Name: n})
	}
	return info
}

func TestDecide(t *testing.T) {
	for name, tt := range map[string]struct {
		dir  herdr.Direction
		info herdr.ProcessInfo
		want action
	}{
		"shell":           {herdr.Left, running("fish"), moveFocus},
		"nothing":         {herdr.Left, herdr.ProcessInfo{}, moveFocus},
		"nvim":            {herdr.Left, running("nvim"), forwardKey},
		"vim by argv0":    {herdr.Right, herdr.ProcessInfo{Foreground: []herdr.Process{{Name: "x", Argv0: "/usr/bin/vim"}}}, forwardKey},
		"fzf down":        {herdr.Down, running("fzf"), forwardKey},
		"fzf up":          {herdr.Up, running("fzf"), forwardKey},
		"fzf left":        {herdr.Left, running("fzf"), moveFocus},
		"fzf right":       {herdr.Right, running("fzf"), moveFocus},
		"vim under shell": {herdr.Left, running("fish", "nvim"), forwardKey},
	} {
		t.Run(name, func(t *testing.T) {
			if got := decide(tt.dir, tt.info); got != tt.want {
				t.Errorf("decide = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestPaneMove(t *testing.T) {
	moved := herdr.FocusResult{Changed: true}
	edge := herdr.FocusResult{Reason: herdr.FocusNoNeighbor}
	for name, tt := range map[string]struct {
		dir       herdr.Direction
		forward   bool
		api       fakeAPI
		wantCalls []string
		wantOuter []string
	}{
		"shell moves focus": {herdr.Left, true, fakeAPI{info: running("fish"), focus: moved},
			[]string{"process_info p1", "focus_direction p1 left"}, nil},
		"nvim gets the key": {herdr.Down, true, fakeAPI{info: running("nvim")},
			[]string{"process_info p1", "send_keys p1 ctrl+j"}, nil},
		"edge hands off": {herdr.Right, true, fakeAPI{info: running("fish"), focus: edge},
			[]string{"process_info p1", "focus_direction p1 right"}, []string{"pane right"}},
		"unchanged for another reason stays": {herdr.Up, true,
			fakeAPI{info: running("fish"), focus: herdr.FocusResult{Reason: herdr.FocusReasonUnknown}},
			[]string{"process_info p1", "focus_direction p1 up"}, nil},
		"process info error still moves": {herdr.Left, true, fakeAPI{infoErr: errors.New("boom"), focus: moved},
			[]string{"process_info p1", "focus_direction p1 left"}, nil},
		// From nvim at its edge: never look at (and send back to) nvim.
		"not forwarding skips process info": {herdr.Left, false, fakeAPI{info: running("nvim"), focus: moved},
			[]string{"focus_direction p1 left"}, nil},
		"not forwarding, edge hands off": {herdr.Up, false, fakeAPI{info: running("nvim"), focus: edge},
			[]string{"focus_direction p1 up"}, []string{"pane up"}},
	} {
		t.Run(name, func(t *testing.T) {
			api, outer := tt.api, &fakeOuter{}
			n := navigator{api: &api, outer: outer, pane: "p1", log: io.Discard}
			if err := n.paneMove(context.Background(), tt.dir, tt.forward); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(api.calls, tt.wantCalls) {
				t.Errorf("api calls = %q, want %q", api.calls, tt.wantCalls)
			}
			if !reflect.DeepEqual(outer.calls, tt.wantOuter) {
				t.Errorf("outer calls = %q, want %q", outer.calls, tt.wantOuter)
			}
		})
	}
}

func TestPaneMoveFocusError(t *testing.T) {
	api, outer := &fakeAPI{info: running("fish"), focusErr: errors.New("boom")}, &fakeOuter{}
	n := navigator{api: api, outer: outer, pane: "p1", log: io.Discard}
	if err := n.paneMove(context.Background(), herdr.Left, true); err == nil {
		t.Fatal("want error")
	}
	if outer.calls != nil {
		t.Errorf("handed off after an error: %q", outer.calls)
	}
}

func tabs(focused int, ids ...string) []herdr.TabInfo {
	var out []herdr.TabInfo
	for i, id := range ids {
		out = append(out, herdr.TabInfo{TabID: herdr.TabID(id), Number: uint(i + 1), Focused: i+1 == focused})
	}
	return out
}

func TestNextTab(t *testing.T) {
	// Deliberately out of order: position comes from Number, not list order.
	shuffled := []herdr.TabInfo{{TabID: "t3", Number: 3}, {TabID: "t1", Number: 1}, {TabID: "t2", Number: 2, Focused: true}}
	for name, tt := range map[string]struct {
		tabs    []herdr.TabInfo
		current herdr.TabID
		delta   int
		want    herdr.TabID
		wantOK  bool
	}{
		"next":               {tabs(1, "t1", "t2", "t3"), "t2", 1, "t3", true},
		"prev":               {tabs(1, "t1", "t2", "t3"), "t2", -1, "t1", true},
		"past last":          {tabs(1, "t1", "t2", "t3"), "t3", 1, "", false},
		"before first":       {tabs(1, "t1", "t2", "t3"), "t1", -1, "", false},
		"single tab":         {tabs(1, "t1"), "t1", 1, "", false},
		"sorted by number":   {shuffled, "t1", 1, "t2", true},
		"unknown uses focus": {shuffled, "gone", 1, "t3", true},
		"empty uses focus":   {tabs(2, "t1", "t2"), "", -1, "t1", true},
	} {
		t.Run(name, func(t *testing.T) {
			got, ok, err := nextTab(tt.tabs, tt.current, tt.delta)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want || ok != tt.wantOK {
				t.Errorf("nextTab = %q, %v; want %q, %v", got, ok, tt.want, tt.wantOK)
			}
		})
	}
	if _, _, err := nextTab(tabs(0, "t1"), "gone", 1); err == nil {
		t.Error("no current and no focused tab: want error")
	}
}

func TestTabMove(t *testing.T) {
	for name, tt := range map[string]struct {
		delta     int
		wantCalls []string
		wantOuter []string
	}{
		"next": {1, []string{"list_tabs w1", "focus_tab t3"}, nil},
		"prev": {-1, []string{"list_tabs w1", "focus_tab t1"}, nil},
	} {
		t.Run(name, func(t *testing.T) {
			api, outer := &fakeAPI{tabs: tabs(2, "t1", "t2", "t3")}, &fakeOuter{}
			n := navigator{api: api, outer: outer, tab: "t2", workspace: "w1", log: io.Discard}
			if err := n.tabMove(context.Background(), tt.delta); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(api.calls, tt.wantCalls) || !reflect.DeepEqual(outer.calls, tt.wantOuter) {
				t.Errorf("api %q outer %q; want %q %q", api.calls, outer.calls, tt.wantCalls, tt.wantOuter)
			}
		})
	}

	api, outer := &fakeAPI{tabs: tabs(1, "t1", "t2")}, &fakeOuter{}
	n := navigator{api: api, outer: outer, tab: "t2", log: io.Discard}
	if err := n.tabMove(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(outer.calls, []string{"tab +1"}) {
		t.Errorf("past last tab: outer %q, want [tab +1]", outer.calls)
	}
}

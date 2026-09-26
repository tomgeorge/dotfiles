package main

import (
	"cmp"
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
	focused  herdr.PaneID // the server's focus; "p1" when empty
	info     herdr.ProcessInfo
	infoErr  error
	focus    herdr.FocusResult
	focusErr error
	// workspaces in any order; tabs per workspace
	workspaces []herdr.WorkspaceInfo
	tabs       map[herdr.WorkspaceID][]herdr.TabInfo
}

func (f *fakeAPI) ProcessInfo(_ context.Context, pane herdr.PaneID) (herdr.ProcessInfo, error) {
	f.calls = append(f.calls, "process_info "+string(pane))
	// Like the server: an empty pane means the focused one, named in the reply.
	info := f.info
	info.PaneID = pane
	if pane == "" {
		info.PaneID = cmp.Or(f.focused, "p1")
	}
	return info, f.infoErr
}

func (f *fakeAPI) SendKeys(_ context.Context, pane herdr.PaneID, keys ...string) error {
	f.calls = append(f.calls, "send_keys "+string(pane)+" "+strings.Join(keys, " "))
	return nil
}

func (f *fakeAPI) FocusDirection(_ context.Context, pane herdr.PaneID, dir herdr.Direction) (herdr.FocusResult, error) {
	f.calls = append(f.calls, "focus_direction "+string(pane)+" "+string(dir))
	return f.focus, f.focusErr
}

func (f *fakeAPI) ListWorkspaces(context.Context) ([]herdr.WorkspaceInfo, error) {
	f.calls = append(f.calls, "list_workspaces")
	return f.workspaces, nil
}

func (f *fakeAPI) ListTabs(_ context.Context, ws herdr.WorkspaceID) ([]herdr.TabInfo, error) {
	f.calls = append(f.calls, "list_tabs "+string(ws))
	return f.tabs[ws], nil
}

func (f *fakeAPI) FocusTab(_ context.Context, tab herdr.TabID) (herdr.TabInfo, error) {
	f.calls = append(f.calls, "focus_tab "+string(tab))
	return herdr.TabInfo{TabID: tab, Focused: true}, nil
}

// fakeMoves is an in-memory moveLog.
type fakeMoves struct{ last herdr.PaneID }

func (m *fakeMoves) lastMove() herdr.PaneID       { return m.last }
func (m *fakeMoves) recordMove(pane herdr.PaneID) { m.last = pane }

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

func TestKey(t *testing.T) {
	moved := herdr.FocusResult{Changed: true, FocusedPaneID: "p2"}
	edge := herdr.FocusResult{Reason: herdr.FocusNoNeighbor}
	for name, tt := range map[string]struct {
		dir       herdr.Direction
		api       fakeAPI
		wantCalls []string
		wantOuter []string
		wantLast  herdr.PaneID
	}{
		// Everything after process_info names the pane it reported, not "".
		"shell moves focus": {herdr.Left, fakeAPI{info: running("fish"), focus: moved},
			[]string{"process_info ", "focus_direction p1 left"}, nil, "p2"},
		"nvim gets the key": {herdr.Down, fakeAPI{info: running("nvim")},
			[]string{"process_info ", "send_keys p1 ctrl+j"}, nil, ""},
		"edge hands off": {herdr.Right, fakeAPI{info: running("fish"), focus: edge},
			[]string{"process_info ", "focus_direction p1 right"}, []string{"pane right"}, ""},
		"unchanged for another reason stays": {herdr.Up,
			fakeAPI{info: running("fish"), focus: herdr.FocusResult{Reason: herdr.FocusReasonUnknown}},
			[]string{"process_info ", "focus_direction p1 up"}, nil, ""},
		"process info error still moves": {herdr.Left, fakeAPI{infoErr: errors.New("boom"), focus: moved},
			[]string{"process_info ", "focus_direction  left"}, nil, "p2"},
	} {
		t.Run(name, func(t *testing.T) {
			api, outer, moves := tt.api, &fakeOuter{}, &fakeMoves{last: "old"}
			n := navigator{api: &api, outer: outer, moves: moves, log: io.Discard}
			if err := n.key(context.Background(), tt.dir); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(api.calls, tt.wantCalls) {
				t.Errorf("api calls = %q, want %q", api.calls, tt.wantCalls)
			}
			if !reflect.DeepEqual(outer.calls, tt.wantOuter) {
				t.Errorf("outer calls = %q, want %q", outer.calls, tt.wantOuter)
			}
			if moves.last != tt.wantLast {
				t.Errorf("last move = %q, want %q", moves.last, tt.wantLast)
			}
		})
	}
}

// nvim in p1 found no window that way. What happens depends on where focus
// is by the time its call runs.
func TestEdge(t *testing.T) {
	moved := herdr.FocusResult{Changed: true, FocusedPaneID: "p3"}
	edge := herdr.FocusResult{Reason: herdr.FocusNoNeighbor}
	for name, tt := range map[string]struct {
		api       fakeAPI
		last      herdr.PaneID
		wantCalls []string
		wantOuter []string
	}{
		"still on nvim's pane: moves from it": {fakeAPI{focused: "p1", info: running("nvim"), focus: moved}, "",
			[]string{"process_info ", "focus_direction p1 left"}, nil},
		"still on nvim's pane at herdr's edge: hands off": {fakeAPI{focused: "p1", info: running("nvim"), focus: edge}, "",
			[]string{"process_info ", "focus_direction p1 left"}, []string{"pane left"}},
		// ctrl+h ctrl+h, both forwarded to nvim before it handed off: the
		// first handoff moved p1 -> p2, so the second carries on from p2.
		"nav moved on: continues from there": {fakeAPI{focused: "p2", info: running("fish"), focus: moved}, "p2",
			[]string{"process_info ", "focus_direction p2 left"}, nil},
		"nav moved on to another nvim: it gets the key": {fakeAPI{focused: "p2", info: running("nvim")}, "p2",
			[]string{"process_info ", "send_keys p2 ctrl+h"}, nil},
		"user moved: dropped": {fakeAPI{focused: "p9", info: running("fish"), focus: moved}, "p2",
			[]string{"process_info "}, nil},
		"focus unknown: moves from nvim's pane": {fakeAPI{infoErr: errors.New("boom"), focus: moved}, "",
			[]string{"process_info ", "focus_direction p1 left"}, nil},
	} {
		t.Run(name, func(t *testing.T) {
			api, outer := tt.api, &fakeOuter{}
			n := navigator{api: &api, outer: outer, moves: &fakeMoves{last: tt.last}, log: io.Discard}
			if err := n.edge(context.Background(), "p1", herdr.Left); err != nil {
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

func TestMoveFocusError(t *testing.T) {
	api, outer, moves := &fakeAPI{focusErr: errors.New("boom")}, &fakeOuter{}, &fakeMoves{last: "p2"}
	n := navigator{api: api, outer: outer, moves: moves, log: io.Discard}
	if err := n.move(context.Background(), "p1", herdr.Left); err == nil {
		t.Fatal("want error")
	}
	if outer.calls != nil {
		t.Errorf("handed off after an error: %q", outer.calls)
	}
	if moves.last != "" {
		t.Errorf("last move = %q after an error, want cleared", moves.last)
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
			got, ok := nextTab(tt.tabs, tt.current, tt.delta)
			if got != tt.want || ok != tt.wantOK {
				t.Errorf("nextTab = %q, %v; want %q, %v", got, ok, tt.want, tt.wantOK)
			}
		})
	}
	if _, ok := nextTab(tabs(0, "t1"), "gone", 1); ok {
		t.Error("no current and no focused tab: want ok=false")
	}
}

// session builds workspaces w1..wN in sidebar order, listed out of order,
// with tabs[i] tabs in workspace i+1 (ids "w<i>:t<n>"). focusWs/focusTab
// (1-based) say what's focused.
func session(focusWs, focusTab int, tabs ...int) *fakeAPI {
	api := &fakeAPI{tabs: map[herdr.WorkspaceID][]herdr.TabInfo{}}
	for i := len(tabs) - 1; i >= 0; i-- { // reversed: order must come from Number
		ws := herdr.WorkspaceID(fmt.Sprintf("w%d", i+1))
		active := herdr.TabID(fmt.Sprintf("%s:t1", ws))
		for n := tabs[i]; n >= 1; n-- {
			id := herdr.TabID(fmt.Sprintf("%s:t%d", ws, n))
			focused := i+1 == focusWs && n == focusTab
			if focused {
				active = id
			}
			api.tabs[ws] = append(api.tabs[ws], herdr.TabInfo{TabID: id, WorkspaceID: ws, Number: uint(n), Focused: focused})
		}
		api.workspaces = append(api.workspaces, herdr.WorkspaceInfo{
			WorkspaceID: ws, Number: uint(i + 1), Focused: i+1 == focusWs, ActiveTabID: active, TabCount: uint(tabs[i]),
		})
	}
	return api
}

// unplaceable is a session whose focused workspace names an active tab that
// tab.list doesn't have, as mid-change.
func unplaceable() *fakeAPI {
	api := session(1, 1, 2, 2)
	for i := range api.workspaces {
		if api.workspaces[i].WorkspaceID == "w1" {
			api.workspaces[i].ActiveTabID = "w1:gone"
		}
	}
	for i := range api.tabs["w1"] {
		api.tabs["w1"][i].Focused = false
	}
	return api
}

func TestTabMove(t *testing.T) {
	for name, tt := range map[string]struct {
		api       *fakeAPI
		delta     int
		wantFocus string // "" = no focus_tab call
		wantOuter []string
	}{
		"next within workspace":            {session(1, 2, 3, 2), 1, "w1:t3", nil},
		"prev within workspace":            {session(1, 2, 3, 2), -1, "w1:t1", nil},
		"past last tab to next ws":         {session(1, 3, 3, 2), 1, "w2:t1", nil},
		"before first tab to prev ws":      {session(2, 1, 3, 2), -1, "w1:t3", nil},
		"past last ws hands off":           {session(2, 2, 3, 2), 1, "", []string{"tab +1"}},
		"before first ws hands off":        {session(1, 1, 3, 2), -1, "", []string{"tab -1"}},
		"single tab, single ws":            {session(1, 1, 1), 1, "", []string{"tab +1"}},
		"skips a workspace with no tabs":   {session(1, 1, 1, 0, 2), 1, "w3:t1", nil},
		"unplaceable current tab moves on": {unplaceable(), 1, "w2:t1", nil},
	} {
		t.Run(name, func(t *testing.T) {
			outer, moves := &fakeOuter{}, &fakeMoves{last: "p1"}
			n := navigator{api: tt.api, outer: outer, moves: moves, log: io.Discard}
			if err := n.tabMove(context.Background(), tt.delta); err != nil {
				t.Fatal(err)
			}
			var focus string
			for _, c := range tt.api.calls {
				if f, ok := strings.CutPrefix(c, "focus_tab "); ok {
					focus = f
				}
			}
			if moves.last != "" {
				t.Errorf("last move = %q after a tab move, want cleared", moves.last)
			}
			if focus != tt.wantFocus || !reflect.DeepEqual(outer.calls, tt.wantOuter) {
				t.Errorf("focused %q, outer %q; want %q, %q (calls %q)", focus, outer.calls, tt.wantFocus, tt.wantOuter, tt.api.calls)
			}
		})
	}
}

func TestTabMoveNoFocusedWorkspace(t *testing.T) {
	api := session(0, 0, 2)
	n := navigator{api: api, outer: &fakeOuter{}, moves: &fakeMoves{}, log: io.Discard}
	if err := n.tabMove(context.Background(), 1); err == nil {
		t.Error("want error")
	}
}

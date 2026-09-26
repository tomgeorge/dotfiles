package herdr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

// oneLine compacts a readable fixture: replies are newline-framed.
func oneLine(s string) string {
	var b bytes.Buffer
	if err := json.Compact(&b, []byte(s)); err != nil {
		panic(err)
	}
	return b.String()
}

var processInfoOK = oneLine(`{"type":"pane_process_info","process_info":{
	"pane_id":"w1:p2","shell_pid":10,"foreground_process_group_id":20,"tty":"/dev/ttys001",
	"foreground_processes":[
		{"pid":20,"name":"node","argv0":"pi","cwd":"/src"},
		{"pid":21,"name":"nvim","argv0":"/opt/homebrew/bin/nvim","argv":["nvim","-u","NONE"]}]}}`)

var focusOK = oneLine(`{"type":"pane_focus_direction","focus":{
	"changed":false,"reason":"no_neighbor","source_pane_id":"w1:p1","focused_pane_id":null,
	"layout":{"panes":[],"splits":[]}}}`)

func TestProcessInfo(t *testing.T) {
	c, got := fakeServer(t, answer(processInfoOK))
	info, err := c.ProcessInfo(context.Background(), "w1:p2")
	if err != nil {
		t.Fatal(err)
	}
	req := <-got
	if req.Method != "pane.process_info" || string(req.Params) != `{"pane_id":"w1:p2"}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	u := func(n uint32) *uint32 { return &n }
	want := ProcessInfo{
		PaneID: "w1:p2", ShellPID: u(10), ForegroundPGID: u(20), TTY: "/dev/ttys001",
		Foreground: []Process{
			{PID: 20, Name: "node", Argv0: "pi", Cwd: "/src"},
			{PID: 21, Name: "nvim", Argv0: "/opt/homebrew/bin/nvim", Argv: []string{"nvim", "-u", "NONE"}},
		},
	}
	if !reflect.DeepEqual(info, want) {
		t.Errorf("info = %+v\nwant   %+v", info, want)
	}
}

func TestProcessInfoMinimal(t *testing.T) {
	// Only pane_id is required; a pane whose program exited has nothing else.
	c, got := fakeServer(t, answer(`{"type":"pane_process_info","process_info":{"pane_id":"w1:p1","shell_pid":null}}`))
	info, err := c.ProcessInfo(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; string(req.Params) != `{}` {
		t.Errorf("params = %s, want {} (empty pane means the caller's pane)", req.Params)
	}
	if !reflect.DeepEqual(info, ProcessInfo{PaneID: "w1:p1"}) {
		t.Errorf("info = %+v", info)
	}
}

func TestProcessInfoFind(t *testing.T) {
	info := ProcessInfo{Foreground: []Process{
		{PID: 1, Name: "zsh", Argv0: "-zsh"},
		{PID: 2, Name: "node", Argv0: "pi"},
		{PID: 3, Name: "nvim-real", Argv0: "/opt/homebrew/bin/nvim"},
		{PID: 4, Name: "fzf"},
	}}
	for name, tt := range map[string]struct {
		match func(string) bool
		want  uint32 // 0 = no match
	}{
		"by name":             {func(n string) bool { return n == "fzf" }, 4},
		"by argv0":            {func(n string) bool { return n == "pi" }, 2},
		"argv0 base name":     {func(n string) bool { return n == "nvim" }, 3},
		"first match wins":    {func(n string) bool { return n != "" }, 1},
		"no match":            {func(n string) bool { return n == "vim" }, 0},
		"empty argv0 skipped": {func(n string) bool { return n == "." }, 0},
	} {
		t.Run(name, func(t *testing.T) {
			var got uint32
			if p := info.Find(tt.match); p != nil {
				got = p.PID
			}
			if got != tt.want {
				t.Errorf("pid = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestSendKeys(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"ok"}`))
	if err := c.SendKeys(context.Background(), "w1:p2", "ctrl+h"); err != nil {
		t.Fatal(err)
	}
	req := <-got
	if req.Method != "pane.send_keys" || string(req.Params) != `{"pane_id":"w1:p2","keys":["ctrl+h"]}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
}

func TestFocusDirection(t *testing.T) {
	for name, tt := range map[string]struct {
		result string
		want   FocusResult
	}{
		"edge": {focusOK, FocusResult{Changed: false, Reason: FocusNoNeighbor, SourcePaneID: "w1:p1"}},
		"moved": {
			`{"type":"pane_focus_direction","focus":{"changed":true,"source_pane_id":"w1:p1","focused_pane_id":"w1:p2","layout":{}}}`,
			FocusResult{Changed: true, SourcePaneID: "w1:p1", FocusedPaneID: "w1:p2"},
		},
		"unknown reason": {
			`{"type":"pane_focus_direction","focus":{"changed":false,"reason":"zoomed","source_pane_id":"w1:p1","layout":{}}}`,
			FocusResult{Changed: false, Reason: FocusReasonUnknown, SourcePaneID: "w1:p1"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			c, got := fakeServer(t, answer(tt.result))
			r, err := c.FocusDirection(context.Background(), "w1:p1", Left)
			if err != nil {
				t.Fatal(err)
			}
			req := <-got
			if req.Method != "pane.focus_direction" || string(req.Params) != `{"pane_id":"w1:p1","direction":"left"}` {
				t.Errorf("request = %s %s", req.Method, req.Params)
			}
			if r != tt.want {
				t.Errorf("result = %+v, want %+v", r, tt.want)
			}
		})
	}
}

func TestPaneRejects(t *testing.T) {
	processInfo := func(c *Client) error { _, err := c.ProcessInfo(context.Background(), "w1:p1"); return err }
	focus := func(c *Client) error { _, err := c.FocusDirection(context.Background(), "w1:p1", Up); return err }
	sendKeys := func(c *Client) error { return c.SendKeys(context.Background(), "w1:p1", "ctrl+j") }

	for name, tt := range map[string]struct {
		call   func(*Client) error
		result string
		want   error
	}{
		"process_info wrong tag":       {processInfo, `{"type":"ok"}`, ErrWrongResult},
		"process_info missing object":  {processInfo, `{"type":"pane_process_info"}`, ErrMissingField},
		"process_info missing pane_id": {processInfo, `{"type":"pane_process_info","process_info":{}}`, ErrMissingField},
		"process missing name": {processInfo,
			`{"type":"pane_process_info","process_info":{"pane_id":"p","foreground_processes":[{"pid":1}]}}`, ErrMissingField},
		"process missing pid": {processInfo,
			`{"type":"pane_process_info","process_info":{"pane_id":"p","foreground_processes":[{"name":"sh"}]}}`, ErrMissingField},
		"focus wrong tag":       {focus, `{"type":"ok"}`, ErrWrongResult},
		"focus missing object":  {focus, `{"type":"pane_focus_direction"}`, ErrMissingField},
		"focus missing changed": {focus, `{"type":"pane_focus_direction","focus":{"source_pane_id":"p","layout":{}}}`, ErrMissingField},
		"focus missing source":  {focus, `{"type":"pane_focus_direction","focus":{"changed":true,"layout":{}}}`, ErrMissingField},
		"focus missing layout":  {focus, `{"type":"pane_focus_direction","focus":{"changed":true,"source_pane_id":"p"}}`, ErrMissingField},
		"focus null layout":     {focus, `{"type":"pane_focus_direction","focus":{"changed":true,"source_pane_id":"p","layout":null}}`, ErrMissingField},
		"send_keys wrong tag":   {sendKeys, `{"type":"pong","version":"v","protocol":22}`, ErrWrongResult},
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(tt.result))
			if err := tt.call(c); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

// Every new method must surface a server error as *APIError naming itself.
func TestAPIErrors(t *testing.T) {
	ctx := context.Background()
	for method, call := range map[string]func(*Client) error{
		"pane.process_info":    func(c *Client) error { _, err := c.ProcessInfo(ctx, "p"); return err },
		"pane.send_keys":       func(c *Client) error { return c.SendKeys(ctx, "p", "ctrl+h") },
		"pane.focus_direction": func(c *Client) error { _, err := c.FocusDirection(ctx, "p", Down); return err },
		"tab.list":             func(c *Client) error { _, err := c.ListTabs(ctx, "w1"); return err },
		"workspace.list":       func(c *Client) error { _, err := c.ListWorkspaces(ctx); return err },
		"tab.focus":            func(c *Client) error { _, err := c.FocusTab(ctx, "w1:t1"); return err },
	} {
		t.Run(method, func(t *testing.T) {
			c, _ := fakeServer(t, func(r sent) []byte {
				return []byte(`{"id":` + quote(r.ID) + `,"error":{"code":"pane_not_found","message":"nope"}}` + "\n")
			})
			var apiErr *APIError
			if err := call(c); !errors.As(err, &apiErr) {
				t.Fatalf("err = %v, want *APIError", err)
			}
			if apiErr.Method != method || apiErr.Code != "pane_not_found" {
				t.Errorf("apiErr = %+v", apiErr)
			}
		})
	}
}

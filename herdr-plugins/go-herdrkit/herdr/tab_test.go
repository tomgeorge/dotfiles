package herdr

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func tabJSON(extra string) string {
	return `{"tab_id":"w1:t2","workspace_id":"w1","number":2,"label":"2","focused":true,"pane_count":3` + extra + `}`
}

func TestListTabs(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"tab_list","tabs":[`+
		tabJSON(`,"agent_status":"working"`)+`,`+
		`{"tab_id":"w1:t1","workspace_id":"w1","number":1,"label":"main","focused":false,"pane_count":1,"agent_status":"sleeping"}]}`))
	tabs, err := c.ListTabs(context.Background(), "w1")
	if err != nil {
		t.Fatal(err)
	}
	req := <-got
	if req.Method != "tab.list" || string(req.Params) != `{"workspace_id":"w1"}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	want := []TabInfo{
		{TabID: "w1:t2", WorkspaceID: "w1", Number: 2, Label: "2", Focused: true, PaneCount: 3, AgentStatus: AgentWorking},
		// Unknown statuses decode to AgentUnknown rather than failing.
		{TabID: "w1:t1", WorkspaceID: "w1", Number: 1, Label: "main", PaneCount: 1, AgentStatus: AgentUnknown},
	}
	if !reflect.DeepEqual(tabs, want) {
		t.Errorf("tabs = %+v\nwant   %+v", tabs, want)
	}
}

func TestListTabsFocusedWorkspace(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"tab_list","tabs":[]}`))
	tabs, err := c.ListTabs(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; string(req.Params) != `{}` {
		t.Errorf("params = %s, want {}", req.Params)
	}
	if tabs == nil || len(tabs) != 0 {
		t.Errorf("tabs = %#v, want empty non-nil", tabs)
	}
}

func TestFocusTab(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"ok"}`))
	if err := c.FocusTab(context.Background(), "w1:t3"); err != nil {
		t.Fatal(err)
	}
	req := <-got
	if req.Method != "tab.focus" || string(req.Params) != `{"tab_id":"w1:t3"}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
}

func TestTabRejects(t *testing.T) {
	list := func(c *Client) error { _, err := c.ListTabs(context.Background(), "w1"); return err }
	focus := func(c *Client) error { return c.FocusTab(context.Background(), "w1:t1") }

	for name, tt := range map[string]struct {
		call   func(*Client) error
		result string
		want   error
	}{
		"list wrong tag":     {list, `{"type":"ok"}`, ErrWrongResult},
		"list missing tabs":  {list, `{"type":"tab_list"}`, ErrMissingField},
		"list null tabs":     {list, `{"type":"tab_list","tabs":null}`, ErrMissingField},
		"tab missing status": {list, `{"type":"tab_list","tabs":[` + tabJSON(``) + `]}`, ErrMissingField},
		"tab missing tab_id": {list, `{"type":"tab_list","tabs":[{"workspace_id":"w1"}]}`, ErrMissingField},
		"focus wrong tag":    {focus, `{"type":"tab_list","tabs":[]}`, ErrWrongResult},
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(tt.result))
			if err := tt.call(c); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

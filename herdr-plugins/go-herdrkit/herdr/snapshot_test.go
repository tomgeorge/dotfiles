package herdr

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

const (
	checkoutJSON = `{"repo_key":"/src/dots","repo_name":"dots","repo_root":"/src/dots","checkout_path":"/wt/dots/feature","is_linked_worktree":true}`
	paneJSON     = `{"pane_id":"w2:p1","terminal_id":"term1","workspace_id":"w2","tab_id":"w2:t1","focused":true,"agent_status":"working","revision":4,"cwd":"/home/dev/src"}`
	agentJSON    = `{"pane_id":"w2:p1","terminal_id":"term1","workspace_id":"w2","tab_id":"w2:t1","focused":true,"agent_status":"blocked","revision":4,` +
		`"name":null,"agent":"claude","display_agent":"Claude Code","terminal_title_stripped":"Fix the build"}`
)

func snapshotJSON(fields string) string {
	return `{"type":"session_snapshot","snapshot":{` + fields + `}}`
}

func fullSnapshot() string {
	return snapshotJSON(`"version":"0.9.1","protocol":22,` +
		`"workspaces":[` + wsJSON(`,"agent_status":"idle","worktree":`+checkoutJSON) + `],` +
		`"tabs":[` + tabJSON(`,"agent_status":"idle"`) + `],` +
		`"panes":[` + paneJSON + `],"layouts":[],` +
		`"agents":[` + agentJSON + `],` +
		`"focused_workspace_id":"w2","focused_tab_id":null`)
}

func TestSnapshot(t *testing.T) {
	c, got := fakeServer(t, answer(fullSnapshot()))
	s, err := c.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; req.Method != "session.snapshot" || string(req.Params) != `{}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	want := Snapshot{
		Version:  "0.9.1",
		Protocol: 22,
		Workspaces: []WorkspaceInfo{{
			WorkspaceID: "w2", Number: 2, Label: "api", PaneCount: 3, TabCount: 2, ActiveTabID: "w2:t1", AgentStatus: AgentIdle,
			Worktree: &WorkspaceWorktree{
				Repository:       Repository{Key: "/src/dots", Name: "dots", Root: "/src/dots"},
				CheckoutPath:     "/wt/dots/feature",
				IsLinkedWorktree: true,
			},
		}},
		Tabs:   []TabInfo{{TabID: "w1:t2", WorkspaceID: "w1", Number: 2, Label: "2", Focused: true, PaneCount: 3, AgentStatus: AgentIdle}},
		Panes:  []PaneInfo{{PaneID: "w2:p1", WorkspaceID: "w2", TabID: "w2:t1", Focused: true, AgentStatus: AgentWorking, Cwd: "/home/dev/src"}},
		Agents: []AgentInfo{{PaneID: "w2:p1", WorkspaceID: "w2", TabID: "w2:t1", Focused: true, AgentStatus: AgentBlocked, Agent: "claude", DisplayAgent: "Claude Code", TerminalTitleStripped: "Fix the build"}},

		FocusedWorkspaceID: "w2",
	}
	if !reflect.DeepEqual(s, want) {
		t.Errorf("snapshot = %+v\nwant       %+v", s, want)
	}
}

func TestSnapshotRejects(t *testing.T) {
	full := fullSnapshot()
	for name, tt := range map[string]struct {
		result string
		want   error
	}{
		"wrong tag":         {`{"type":"ok"}`, ErrWrongResult},
		"missing snapshot":  {`{"type":"session_snapshot"}`, ErrMissingField},
		"missing layouts":   {strings.Replace(full, `"layouts":[],`, ``, 1), ErrMissingField},
		"missing agents":    {strings.Replace(full, `"agents":[`+agentJSON+`],`, ``, 1), ErrMissingField},
		"pane missing tab":  {strings.Replace(full, `"tab_id":"w2:t1","focused":true,"agent_status":"working"`, `"focused":true,"agent_status":"working"`, 1), ErrMissingField},
		"agent no status":   {strings.Replace(full, `"agent_status":"blocked",`, ``, 1), ErrMissingField},
		"worktree no root":  {strings.Replace(full, `"repo_root":"/src/dots",`, ``, 1), ErrMissingField},
		"workspace no tabs": {strings.Replace(full, `"tab_count":2,`, ``, 1), ErrMissingField},
	} {
		t.Run(name, func(t *testing.T) {
			if tt.result == full {
				t.Fatal("replacement didn't apply")
			}
			c, _ := fakeServer(t, answer(tt.result))
			if _, err := c.Snapshot(context.Background()); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestSnapshotHelpers(t *testing.T) {
	s := Snapshot{
		Workspaces: []WorkspaceInfo{
			{WorkspaceID: "w1"},
			{WorkspaceID: "w2", Worktree: &WorkspaceWorktree{Repository: Repository{Root: "/src/b"}, CheckoutPath: "/wt/b"}},
			{WorkspaceID: "w3", Worktree: &WorkspaceWorktree{Repository: Repository{Root: "/src/a"}, CheckoutPath: "/src/a"}},
			{WorkspaceID: "w4", Worktree: &WorkspaceWorktree{Repository: Repository{Root: "/src/b"}, CheckoutPath: "/src/b"}},
			{WorkspaceID: "w5"},
		},
		Panes: []PaneInfo{
			{WorkspaceID: "w1", Cwd: ""},
			{WorkspaceID: "w1", Cwd: "/home/dev"},
			{WorkspaceID: "w2", Cwd: "/elsewhere"},
		},
	}
	if got, want := s.RepositoryRoots(), []string{"/src/a", "/src/b"}; !reflect.DeepEqual(got, want) {
		t.Errorf("RepositoryRoots = %q, want %q", got, want)
	}
	for ws, want := range map[WorkspaceID]string{
		"w1": "/home/dev", // first non-empty pane cwd
		"w2": "/wt/b",     // the checkout beats a pane cwd
		"w5": "",          // nothing known
		"w9": "",          // no such workspace
	} {
		if got := s.EffectiveWorkspaceDir(ws); got != want {
			t.Errorf("EffectiveWorkspaceDir(%s) = %q, want %q", ws, got, want)
		}
	}
}

func TestAgentDisplayName(t *testing.T) {
	for _, tt := range []struct {
		agent AgentInfo
		want  string
	}{
		{AgentInfo{PaneID: "w1:p1", Name: "dev", DisplayAgent: "Claude Code", Agent: "claude"}, "dev"},
		{AgentInfo{PaneID: "w1:p1", DisplayAgent: "Claude Code", Agent: "claude"}, "Claude Code"},
		{AgentInfo{PaneID: "w1:p1", Agent: "claude"}, "claude"},
		{AgentInfo{PaneID: "w1:p1"}, "w1:p1"},
	} {
		if got := tt.agent.DisplayName(); got != tt.want {
			t.Errorf("DisplayName(%+v) = %q, want %q", tt.agent, got, tt.want)
		}
	}
}

// Herdr answers both focus calls with the focused object, not a bare ok.
func TestFocusAgent(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"agent_info","agent":`+agentJSON+`}`))
	agent, err := c.FocusAgent(context.Background(), "w2:p1")
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; req.Method != "agent.focus" || string(req.Params) != `{"target":"w2:p1"}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	if agent.PaneID != "w2:p1" || agent.AgentStatus != AgentBlocked {
		t.Errorf("agent = %+v", agent)
	}
}

func TestFocusWorkspace(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"workspace_info","workspace":`+wsJSON(`,"agent_status":"working"`)+`}`))
	ws, err := c.FocusWorkspace(context.Background(), "w3")
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; req.Method != "workspace.focus" || string(req.Params) != `{"workspace_id":"w3"}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	if ws.WorkspaceID != "w2" || ws.AgentStatus != AgentWorking {
		t.Errorf("workspace = %+v", ws)
	}
}

func TestFocusRejects(t *testing.T) {
	focusWS := func(c *Client) error { _, err := c.FocusWorkspace(context.Background(), "w1"); return err }
	focusAgent := func(c *Client) error { _, err := c.FocusAgent(context.Background(), "w1:p1"); return err }
	for name, tt := range map[string]struct {
		call   func(*Client) error
		result string
		want   error
	}{
		"workspace bare ok":        {focusWS, `{"type":"ok"}`, ErrWrongResult},
		"workspace missing":        {focusWS, `{"type":"workspace_info"}`, ErrMissingField},
		"workspace missing status": {focusWS, `{"type":"workspace_info","workspace":` + wsJSON(``) + `}`, ErrMissingField},
		"agent bare ok":            {focusAgent, `{"type":"ok"}`, ErrWrongResult},
		"agent missing":            {focusAgent, `{"type":"agent_info"}`, ErrMissingField},
		"agent missing pane":       {focusAgent, `{"type":"agent_info","agent":{"workspace_id":"w1"}}`, ErrMissingField},
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(tt.result))
			if err := tt.call(c); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestCreateWorkspace(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"workspace_created","workspace":`+wsJSON(`,"agent_status":"idle"`)+
		`,"tab":`+tabJSON(`,"agent_status":"idle"`)+`,"root_pane":`+paneJSON+`}`))
	created, err := c.CreateWorkspace(context.Background(), "/home/dev/notes", "notes", true)
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; req.Method != "workspace.create" || string(req.Params) != `{"cwd":"/home/dev/notes","label":"notes","focus":true}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	if created.Workspace.WorkspaceID != "w2" || created.Tab.TabID != "w1:t2" || created.RootPane.PaneID != "w2:p1" {
		t.Errorf("created = %+v", created)
	}

	c, got = fakeServer(t, answer(`{"type":"workspace_created"}`))
	if _, err := c.CreateWorkspace(context.Background(), "/x", "", false); !errors.Is(err, ErrMissingField) {
		t.Errorf("err = %v, want ErrMissingField", err)
	}
	if req := <-got; string(req.Params) != `{"cwd":"/x","focus":false}` {
		t.Errorf("params = %s: an empty label must be omitted", req.Params)
	}
}

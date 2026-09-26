package herdr

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func wsJSON(extra string) string {
	return `{"workspace_id":"w2","number":2,"label":"api","focused":false,"pane_count":3,"tab_count":2,"active_tab_id":"w2:t1"` + extra + `}`
}

func TestListWorkspaces(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"workspace_list","workspaces":[`+wsJSON(`,"agent_status":"idle","worktree":null,"tokens":{}`)+`]}`))
	wss, err := c.ListWorkspaces(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; req.Method != "workspace.list" || string(req.Params) != `{}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	want := []WorkspaceInfo{{WorkspaceID: "w2", Number: 2, Label: "api", PaneCount: 3, TabCount: 2, ActiveTabID: "w2:t1", AgentStatus: AgentIdle}}
	if !reflect.DeepEqual(wss, want) {
		t.Errorf("workspaces = %+v\nwant         %+v", wss, want)
	}
}

func TestListWorkspacesRejects(t *testing.T) {
	for name, tt := range map[string]struct {
		result string
		want   error
	}{
		"wrong tag":            {`{"type":"tab_list","tabs":[]}`, ErrWrongResult},
		"missing workspaces":   {`{"type":"workspace_list"}`, ErrMissingField},
		"missing agent_status": {`{"type":"workspace_list","workspaces":[` + wsJSON(``) + `]}`, ErrMissingField},
		"missing number":       {`{"type":"workspace_list","workspaces":[{"workspace_id":"w1"}]}`, ErrMissingField},
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(tt.result))
			if _, err := c.ListWorkspaces(context.Background()); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

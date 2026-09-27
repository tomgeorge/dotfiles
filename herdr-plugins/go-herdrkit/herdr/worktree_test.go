package herdr

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

const (
	sourceJSON  = `{"repo_key":"/src/dots","repo_name":"dots","repo_root":"/src/dots","source_checkout_path":"/src/dots","source_workspace_id":null}`
	releaseJSON = `{"path":"/wt/dots/release","label":"release","branch":"release","is_bare":false,"is_detached":false,"is_prunable":false,"is_linked_worktree":true,"open_workspace_id":null}`
)

func TestListWorktrees(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"worktree_list","source":`+sourceJSON+`,"worktrees":[`+releaseJSON+`,`+
		`{"path":"/src/dots","label":"main","branch":null,"is_bare":false,"is_detached":true,"is_prunable":false,"is_linked_worktree":false,"open_workspace_id":"w2"}]}`))
	list, err := c.ListWorktrees(context.Background(), "/src/dots")
	if err != nil {
		t.Fatal(err)
	}
	if req := <-got; req.Method != "worktree.list" || string(req.Params) != `{"cwd":"/src/dots"}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	want := WorktreeList{
		Source: WorktreeSource{Repository: Repository{Key: "/src/dots", Name: "dots", Root: "/src/dots"}, SourceCheckoutPath: "/src/dots"},
		Worktrees: []Worktree{
			{Path: "/wt/dots/release", Label: "release", Branch: "release", IsLinkedWorktree: true},
			{Path: "/src/dots", Label: "main", IsDetached: true, OpenWorkspaceID: "w2"},
		},
	}
	if !reflect.DeepEqual(list, want) {
		t.Errorf("list = %+v\nwant   %+v", list, want)
	}
}

func TestListWorktreesRejects(t *testing.T) {
	for name, tt := range map[string]struct {
		result string
		want   error
	}{
		"wrong tag":         {`{"type":"ok"}`, ErrWrongResult},
		"missing source":    {`{"type":"worktree_list","worktrees":[]}`, ErrMissingField},
		"source no root":    {`{"type":"worktree_list","source":{"repo_key":"k","repo_name":"n","source_checkout_path":"/p"},"worktrees":[]}`, ErrMissingField},
		"missing worktrees": {`{"type":"worktree_list","source":` + sourceJSON + `}`, ErrMissingField},
		"worktree no path":  {`{"type":"worktree_list","source":` + sourceJSON + `,"worktrees":[{"label":"x"}]}`, ErrMissingField},
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := fakeServer(t, answer(tt.result))
			if _, err := c.ListWorktrees(context.Background(), "/src/dots"); !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestOpenWorktree(t *testing.T) {
	c, got := fakeServer(t, answer(`{"type":"worktree_opened","workspace":`+wsJSON(`,"agent_status":"idle"`)+
		`,"tab":`+tabJSON(`,"agent_status":"idle"`)+`,"root_pane":`+paneJSON+`,"worktree":`+releaseJSON+`,"already_open":false}`))
	opened, err := c.OpenWorktree(context.Background(), "/src/dots", "/wt/dots/release", true)
	if err != nil {
		t.Fatal(err)
	}
	// cwd names the repository and path the checkout; they aren't interchangeable.
	if req := <-got; req.Method != "worktree.open" || string(req.Params) != `{"cwd":"/src/dots","path":"/wt/dots/release","focus":true}` {
		t.Errorf("request = %s %s", req.Method, req.Params)
	}
	if opened.Workspace.WorkspaceID != "w2" || opened.Worktree.Path != "/wt/dots/release" || opened.AlreadyOpen {
		t.Errorf("opened = %+v", opened)
	}

	c, _ = fakeServer(t, answer(`{"type":"worktree_opened","workspace":`+wsJSON(`,"agent_status":"idle"`)+
		`,"tab":`+tabJSON(`,"agent_status":"idle"`)+`,"root_pane":`+paneJSON+`,"worktree":`+releaseJSON+`}`))
	if _, err := c.OpenWorktree(context.Background(), "/src/dots", "/wt/dots/release", true); !errors.Is(err, ErrMissingField) {
		t.Errorf("err = %v, want ErrMissingField for missing already_open", err)
	}
}

func TestWorktreeOpenableAndBranch(t *testing.T) {
	for _, tt := range []struct {
		wt       Worktree
		openable bool
		branch   string
	}{
		{Worktree{Branch: "main"}, true, "main"},
		{Worktree{Branch: "main", OpenWorkspaceID: "w1"}, false, "main"},
		{Worktree{IsBare: true}, false, "-"},
		{Worktree{Branch: "old", IsPrunable: true}, false, "old"},
		{Worktree{IsDetached: true}, true, "(detached)"},
	} {
		if got := tt.wt.Openable(); got != tt.openable {
			t.Errorf("Openable(%+v) = %v, want %v", tt.wt, got, tt.openable)
		}
		if got := tt.wt.BranchLabel(); got != tt.branch {
			t.Errorf("BranchLabel(%+v) = %q, want %q", tt.wt, got, tt.branch)
		}
	}
}

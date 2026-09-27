package herdr

import "context"

// WorkspaceInfo describes one workspace.
type WorkspaceInfo struct {
	WorkspaceID WorkspaceID
	// Number is the workspace's 1-based position in the sidebar.
	Number      uint
	Label       string
	Focused     bool
	PaneCount   uint
	TabCount    uint
	ActiveTabID TabID
	AgentStatus AgentStatus
	// Worktree is nil unless the workspace is a git checkout Herdr tracks.
	Worktree *WorkspaceWorktree
}

// Repository identifies a git repository Herdr knows about.
type Repository struct {
	Key  string
	Name string
	Root string
}

// WorkspaceWorktree is the checkout a workspace was opened on.
type WorkspaceWorktree struct {
	Repository       Repository
	CheckoutPath     string
	IsLinkedWorktree bool
}

// ListWorkspaces lists every workspace.
func (c *Client) ListWorkspaces(ctx context.Context) ([]WorkspaceInfo, error) {
	return call[workspaceListWire, []WorkspaceInfo](ctx, c, "workspace.list", "workspace_list", struct{}{}, DefaultTimeout)
}

// FocusWorkspace focuses a workspace and returns it as it now is.
func (c *Client) FocusWorkspace(ctx context.Context, workspace WorkspaceID) (WorkspaceInfo, error) {
	params := struct {
		WorkspaceID WorkspaceID `json:"workspace_id"`
	}{workspace}
	return call[workspaceInfoResultWire, WorkspaceInfo](ctx, c, "workspace.focus", "workspace_info", params, DefaultTimeout)
}

type workspaceInfoResultWire struct {
	Workspace *workspaceInfoWire `json:"workspace"`
}

func (w workspaceInfoResultWire) result(method string) (WorkspaceInfo, error) {
	if w.Workspace == nil {
		return WorkspaceInfo{}, missing(method, "workspace")
	}
	return w.Workspace.info(method, "workspace.")
}

// WorkspaceCreated is what CreateWorkspace made.
type WorkspaceCreated struct {
	Workspace WorkspaceInfo
	Tab       TabInfo
	RootPane  PaneInfo
}

// CreateWorkspace opens a new workspace in cwd. An empty label lets Herdr
// choose one.
func (c *Client) CreateWorkspace(ctx context.Context, cwd, label string, focus bool) (WorkspaceCreated, error) {
	params := struct {
		Cwd   string `json:"cwd"`
		Label string `json:"label,omitempty"`
		Focus bool   `json:"focus"`
	}{cwd, label, focus}
	return call[workspaceCreatedWire, WorkspaceCreated](ctx, c, "workspace.create", "workspace_created", params, DefaultTimeout)
}

type workspaceListWire struct {
	Workspaces *[]workspaceInfoWire `json:"workspaces"`
}

type workspaceInfoWire struct {
	WorkspaceID *string                `json:"workspace_id"`
	Number      *uint                  `json:"number"`
	Label       *string                `json:"label"`
	Focused     *bool                  `json:"focused"`
	PaneCount   *uint                  `json:"pane_count"`
	TabCount    *uint                  `json:"tab_count"`
	ActiveTabID *string                `json:"active_tab_id"`
	AgentStatus *AgentStatus           `json:"agent_status"`
	Worktree    *workspaceWorktreeWire `json:"worktree"`
}

type workspaceWorktreeWire struct {
	RepoKey          *string `json:"repo_key"`
	RepoName         *string `json:"repo_name"`
	RepoRoot         *string `json:"repo_root"`
	CheckoutPath     *string `json:"checkout_path"`
	IsLinkedWorktree *bool   `json:"is_linked_worktree"`
}

func (w workspaceListWire) result(method string) ([]WorkspaceInfo, error) {
	if w.Workspaces == nil {
		return nil, missing(method, "workspaces")
	}
	return workspaceInfos(method, "workspaces[].", *w.Workspaces)
}

func workspaceInfos(method, prefix string, ws []workspaceInfoWire) ([]WorkspaceInfo, error) {
	out := make([]WorkspaceInfo, 0, len(ws))
	for _, w := range ws {
		info, err := w.info(method, prefix)
		if err != nil {
			return nil, err
		}
		out = append(out, info)
	}
	return out, nil
}

// info validates required fields; prefix locates them in error messages.
func (ws workspaceInfoWire) info(method, prefix string) (WorkspaceInfo, error) {
	for _, f := range []struct {
		name   string
		absent bool
	}{
		{"workspace_id", ws.WorkspaceID == nil},
		{"number", ws.Number == nil},
		{"label", ws.Label == nil},
		{"focused", ws.Focused == nil},
		{"pane_count", ws.PaneCount == nil},
		{"tab_count", ws.TabCount == nil},
		{"active_tab_id", ws.ActiveTabID == nil},
		{"agent_status", ws.AgentStatus == nil},
	} {
		if f.absent {
			return WorkspaceInfo{}, missing(method, prefix+f.name)
		}
	}
	info := WorkspaceInfo{
		WorkspaceID: WorkspaceID(*ws.WorkspaceID),
		Number:      *ws.Number,
		Label:       *ws.Label,
		Focused:     *ws.Focused,
		PaneCount:   *ws.PaneCount,
		TabCount:    *ws.TabCount,
		ActiveTabID: TabID(*ws.ActiveTabID),
		AgentStatus: *ws.AgentStatus,
	}
	if wt := ws.Worktree; wt != nil {
		for _, f := range []struct {
			name   string
			absent bool
		}{
			{"repo_key", wt.RepoKey == nil},
			{"repo_name", wt.RepoName == nil},
			{"repo_root", wt.RepoRoot == nil},
			{"checkout_path", wt.CheckoutPath == nil},
			{"is_linked_worktree", wt.IsLinkedWorktree == nil},
		} {
			if f.absent {
				return WorkspaceInfo{}, missing(method, prefix+"worktree."+f.name)
			}
		}
		info.Worktree = &WorkspaceWorktree{
			Repository:       Repository{Key: *wt.RepoKey, Name: *wt.RepoName, Root: *wt.RepoRoot},
			CheckoutPath:     *wt.CheckoutPath,
			IsLinkedWorktree: *wt.IsLinkedWorktree,
		}
	}
	return info, nil
}

type workspaceCreatedWire struct {
	Workspace *workspaceInfoWire `json:"workspace"`
	Tab       *tabInfoWire       `json:"tab"`
	RootPane  *paneInfoWire      `json:"root_pane"`
}

func (w workspaceCreatedWire) result(method string) (WorkspaceCreated, error) {
	switch {
	case w.Workspace == nil:
		return WorkspaceCreated{}, missing(method, "workspace")
	case w.Tab == nil:
		return WorkspaceCreated{}, missing(method, "tab")
	case w.RootPane == nil:
		return WorkspaceCreated{}, missing(method, "root_pane")
	}
	ws, err := w.Workspace.info(method, "workspace.")
	if err != nil {
		return WorkspaceCreated{}, err
	}
	tab, err := w.Tab.info(method, "tab.")
	if err != nil {
		return WorkspaceCreated{}, err
	}
	pane, err := w.RootPane.info(method, "root_pane.")
	if err != nil {
		return WorkspaceCreated{}, err
	}
	return WorkspaceCreated{Workspace: ws, Tab: tab, RootPane: pane}, nil
}

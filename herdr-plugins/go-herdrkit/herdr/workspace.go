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
}

// ListWorkspaces lists every workspace.
func (c *Client) ListWorkspaces(ctx context.Context) ([]WorkspaceInfo, error) {
	return call[workspaceListWire, []WorkspaceInfo](ctx, c, "workspace.list", "workspace_list", struct{}{}, DefaultTimeout)
}

type workspaceListWire struct {
	Workspaces *[]workspaceInfoWire `json:"workspaces"`
}

type workspaceInfoWire struct {
	WorkspaceID *string      `json:"workspace_id"`
	Number      *uint        `json:"number"`
	Label       *string      `json:"label"`
	Focused     *bool        `json:"focused"`
	PaneCount   *uint        `json:"pane_count"`
	TabCount    *uint        `json:"tab_count"`
	ActiveTabID *string      `json:"active_tab_id"`
	AgentStatus *AgentStatus `json:"agent_status"`
}

func (w workspaceListWire) result(method string) ([]WorkspaceInfo, error) {
	if w.Workspaces == nil {
		return nil, missing(method, "workspaces")
	}
	out := make([]WorkspaceInfo, 0, len(*w.Workspaces))
	for _, ws := range *w.Workspaces {
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
				return nil, missing(method, "workspaces[]."+f.name)
			}
		}
		out = append(out, WorkspaceInfo{
			WorkspaceID: WorkspaceID(*ws.WorkspaceID),
			Number:      *ws.Number,
			Label:       *ws.Label,
			Focused:     *ws.Focused,
			PaneCount:   *ws.PaneCount,
			TabCount:    *ws.TabCount,
			ActiveTabID: TabID(*ws.ActiveTabID),
			AgentStatus: *ws.AgentStatus,
		})
	}
	return out, nil
}

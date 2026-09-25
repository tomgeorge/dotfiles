package herdr

import "context"

// TabInfo describes one tab.
type TabInfo struct {
	TabID       TabID
	WorkspaceID WorkspaceID
	// Number is the tab's 1-based position in its workspace.
	Number      uint
	Label       string
	Focused     bool
	PaneCount   uint
	AgentStatus AgentStatus
}

// ListTabs lists the tabs of a workspace, or of the focused workspace when
// workspace is empty.
func (c *Client) ListTabs(ctx context.Context, workspace WorkspaceID) ([]TabInfo, error) {
	params := struct {
		WorkspaceID WorkspaceID `json:"workspace_id,omitempty"`
	}{workspace}
	return call[tabListWire, []TabInfo](ctx, c, "tab.list", "tab_list", params, DefaultTimeout)
}

// FocusTab focuses a tab.
func (c *Client) FocusTab(ctx context.Context, tab TabID) error {
	params := struct {
		TabID TabID `json:"tab_id"`
	}{tab}
	_, err := call[okWire, struct{}](ctx, c, "tab.focus", "ok", params, DefaultTimeout)
	return err
}

type tabListWire struct {
	Tabs *[]tabInfoWire `json:"tabs"`
}

type tabInfoWire struct {
	TabID       *string      `json:"tab_id"`
	WorkspaceID *string      `json:"workspace_id"`
	Number      *uint        `json:"number"`
	Label       *string      `json:"label"`
	Focused     *bool        `json:"focused"`
	PaneCount   *uint        `json:"pane_count"`
	AgentStatus *AgentStatus `json:"agent_status"`
}

func (w tabListWire) result(method string) ([]TabInfo, error) {
	if w.Tabs == nil {
		return nil, missing(method, "tabs")
	}
	tabs := make([]TabInfo, 0, len(*w.Tabs))
	for _, t := range *w.Tabs {
		info, err := t.info(method)
		if err != nil {
			return nil, err
		}
		tabs = append(tabs, info)
	}
	return tabs, nil
}

func (t tabInfoWire) info(method string) (TabInfo, error) {
	for _, f := range []struct {
		name   string
		absent bool
	}{
		{"tab_id", t.TabID == nil},
		{"workspace_id", t.WorkspaceID == nil},
		{"number", t.Number == nil},
		{"label", t.Label == nil},
		{"focused", t.Focused == nil},
		{"pane_count", t.PaneCount == nil},
		{"agent_status", t.AgentStatus == nil},
	} {
		if f.absent {
			return TabInfo{}, missing(method, "tabs[]."+f.name)
		}
	}
	return TabInfo{
		TabID:       TabID(*t.TabID),
		WorkspaceID: WorkspaceID(*t.WorkspaceID),
		Number:      *t.Number,
		Label:       *t.Label,
		Focused:     *t.Focused,
		PaneCount:   *t.PaneCount,
		AgentStatus: *t.AgentStatus,
	}, nil
}

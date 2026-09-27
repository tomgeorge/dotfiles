package herdr

import (
	"context"
	"slices"
)

// PaneInfo describes one pane. Only the fields plugins here use are decoded.
type PaneInfo struct {
	PaneID      PaneID
	WorkspaceID WorkspaceID
	TabID       TabID
	Focused     bool
	AgentStatus AgentStatus
	// Cwd is empty when the server doesn't know it.
	Cwd string
}

// AgentInfo describes an agent Herdr detected in a pane.
type AgentInfo struct {
	PaneID      PaneID
	WorkspaceID WorkspaceID
	TabID       TabID
	Focused     bool
	AgentStatus AgentStatus
	// Name is the user-given name; Agent and DisplayAgent the detected kind
	// ("claude", "Claude Code"). Each is empty when unknown.
	Name         string
	Agent        string
	DisplayAgent string
	// TerminalTitleStripped is the pane's title without decoration, usually
	// the task the agent is on.
	TerminalTitleStripped string
}

// DisplayName is the most specific non-empty name for the agent, falling
// back to its pane id.
func (a AgentInfo) DisplayName() string {
	for _, name := range []string{a.Name, a.DisplayAgent, a.Agent} {
		if name != "" {
			return name
		}
	}
	return string(a.PaneID)
}

// Snapshot is the whole session at one instant.
type Snapshot struct {
	Version    string
	Protocol   uint
	Workspaces []WorkspaceInfo
	Tabs       []TabInfo
	Panes      []PaneInfo
	Agents     []AgentInfo
	// The focused ids are empty when nothing has focus.
	FocusedWorkspaceID WorkspaceID
	FocusedTabID       TabID
	FocusedPaneID      PaneID
}

// Snapshot reads the whole session in one call.
func (c *Client) Snapshot(ctx context.Context) (Snapshot, error) {
	return call[snapshotWire, Snapshot](ctx, c, "session.snapshot", "session_snapshot", struct{}{}, DefaultTimeout)
}

// RepositoryRoots lists, sorted and without duplicates, the root of every
// repository a workspace is checked out from.
func (s Snapshot) RepositoryRoots() []string {
	var roots []string
	for _, ws := range s.Workspaces {
		if ws.Worktree != nil {
			roots = append(roots, ws.Worktree.Repository.Root)
		}
	}
	slices.Sort(roots)
	return slices.Compact(roots)
}

// EffectiveWorkspaceDir is the directory a workspace stands for: its
// checkout if it has one, else the first known cwd among its panes. It is
// empty when neither is known.
func (s Snapshot) EffectiveWorkspaceDir(workspace WorkspaceID) string {
	i := slices.IndexFunc(s.Workspaces, func(ws WorkspaceInfo) bool { return ws.WorkspaceID == workspace })
	if i < 0 {
		return ""
	}
	if wt := s.Workspaces[i].Worktree; wt != nil && wt.CheckoutPath != "" {
		return wt.CheckoutPath
	}
	for _, p := range s.Panes {
		if p.WorkspaceID == workspace && p.Cwd != "" {
			return p.Cwd
		}
	}
	return ""
}

// FocusAgent focuses the agent running in pane and returns it as it now
// is. A pane id, unlike a name, can't match two agents.
func (c *Client) FocusAgent(ctx context.Context, pane PaneID) (AgentInfo, error) {
	params := struct {
		Target PaneID `json:"target"`
	}{pane}
	return call[agentInfoResultWire, AgentInfo](ctx, c, "agent.focus", "agent_info", params, DefaultTimeout)
}

type agentInfoResultWire struct {
	Agent *agentInfoWire `json:"agent"`
}

func (w agentInfoResultWire) result(method string) (AgentInfo, error) {
	if w.Agent == nil {
		return AgentInfo{}, missing(method, "agent")
	}
	return w.Agent.info(method, "agent.")
}

type snapshotWire struct {
	Snapshot *struct {
		Version    *string              `json:"version"`
		Protocol   *uint                `json:"protocol"`
		Workspaces *[]workspaceInfoWire `json:"workspaces"`
		Tabs       *[]tabInfoWire       `json:"tabs"`
		Panes      *[]paneInfoWire      `json:"panes"`
		Agents     *[]agentInfoWire     `json:"agents"`
		// Required but unused; only its presence is checked.
		Layouts            *rawPresent `json:"layouts"`
		FocusedWorkspaceID *string     `json:"focused_workspace_id"`
		FocusedTabID       *string     `json:"focused_tab_id"`
		FocusedPaneID      *string     `json:"focused_pane_id"`
	} `json:"snapshot"`
}

func (w snapshotWire) result(method string) (Snapshot, error) {
	s := w.Snapshot
	if s == nil {
		return Snapshot{}, missing(method, "snapshot")
	}
	for _, f := range []struct {
		name   string
		absent bool
	}{
		{"version", s.Version == nil},
		{"protocol", s.Protocol == nil},
		{"workspaces", s.Workspaces == nil},
		{"tabs", s.Tabs == nil},
		{"panes", s.Panes == nil},
		{"layouts", s.Layouts == nil},
		{"agents", s.Agents == nil},
	} {
		if f.absent {
			return Snapshot{}, missing(method, "snapshot."+f.name)
		}
	}
	out := Snapshot{
		Version:            *s.Version,
		Protocol:           *s.Protocol,
		FocusedWorkspaceID: WorkspaceID(deref(s.FocusedWorkspaceID)),
		FocusedTabID:       TabID(deref(s.FocusedTabID)),
		FocusedPaneID:      PaneID(deref(s.FocusedPaneID)),
	}
	var err error
	if out.Workspaces, err = workspaceInfos(method, "snapshot.workspaces[].", *s.Workspaces); err != nil {
		return Snapshot{}, err
	}
	out.Tabs = make([]TabInfo, 0, len(*s.Tabs))
	for _, t := range *s.Tabs {
		info, err := t.info(method, "snapshot.tabs[].")
		if err != nil {
			return Snapshot{}, err
		}
		out.Tabs = append(out.Tabs, info)
	}
	out.Panes = make([]PaneInfo, 0, len(*s.Panes))
	for _, p := range *s.Panes {
		info, err := p.info(method, "snapshot.panes[].")
		if err != nil {
			return Snapshot{}, err
		}
		out.Panes = append(out.Panes, info)
	}
	out.Agents = make([]AgentInfo, 0, len(*s.Agents))
	for _, a := range *s.Agents {
		info, err := a.info(method, "snapshot.agents[].")
		if err != nil {
			return Snapshot{}, err
		}
		out.Agents = append(out.Agents, info)
	}
	return out, nil
}

type paneInfoWire struct {
	PaneID      *string      `json:"pane_id"`
	WorkspaceID *string      `json:"workspace_id"`
	TabID       *string      `json:"tab_id"`
	Focused     *bool        `json:"focused"`
	AgentStatus *AgentStatus `json:"agent_status"`
	Cwd         *string      `json:"cwd"`
}

func (p paneInfoWire) info(method, prefix string) (PaneInfo, error) {
	for _, f := range []struct {
		name   string
		absent bool
	}{
		{"pane_id", p.PaneID == nil},
		{"workspace_id", p.WorkspaceID == nil},
		{"tab_id", p.TabID == nil},
		{"focused", p.Focused == nil},
		{"agent_status", p.AgentStatus == nil},
	} {
		if f.absent {
			return PaneInfo{}, missing(method, prefix+f.name)
		}
	}
	return PaneInfo{
		PaneID:      PaneID(*p.PaneID),
		WorkspaceID: WorkspaceID(*p.WorkspaceID),
		TabID:       TabID(*p.TabID),
		Focused:     *p.Focused,
		AgentStatus: *p.AgentStatus,
		Cwd:         deref(p.Cwd),
	}, nil
}

type agentInfoWire struct {
	PaneID                *string      `json:"pane_id"`
	WorkspaceID           *string      `json:"workspace_id"`
	TabID                 *string      `json:"tab_id"`
	Focused               *bool        `json:"focused"`
	AgentStatus           *AgentStatus `json:"agent_status"`
	Name                  *string      `json:"name"`
	Agent                 *string      `json:"agent"`
	DisplayAgent          *string      `json:"display_agent"`
	TerminalTitleStripped *string      `json:"terminal_title_stripped"`
}

func (a agentInfoWire) info(method, prefix string) (AgentInfo, error) {
	for _, f := range []struct {
		name   string
		absent bool
	}{
		{"pane_id", a.PaneID == nil},
		{"workspace_id", a.WorkspaceID == nil},
		{"tab_id", a.TabID == nil},
		{"focused", a.Focused == nil},
		{"agent_status", a.AgentStatus == nil},
	} {
		if f.absent {
			return AgentInfo{}, missing(method, prefix+f.name)
		}
	}
	return AgentInfo{
		PaneID:                PaneID(*a.PaneID),
		WorkspaceID:           WorkspaceID(*a.WorkspaceID),
		TabID:                 TabID(*a.TabID),
		Focused:               *a.Focused,
		AgentStatus:           *a.AgentStatus,
		Name:                  deref(a.Name),
		Agent:                 deref(a.Agent),
		DisplayAgent:          deref(a.DisplayAgent),
		TerminalTitleStripped: deref(a.TerminalTitleStripped),
	}, nil
}

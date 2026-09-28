package main

import (
	"github.com/tomgeorge/go-herdrkit/herdr"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/picker"
	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

// Column widths, in terminal cells. Workspaces and worktrees share a set:
// a worktree is a checkout not yet open as a workspace, so their columns
// line up for comparison.
const (
	glyphCells       = 2
	repoCells        = 14
	branchCells      = 24
	markCells        = 2
	agentNameCells   = 16
	agentRepoCells   = 13
	agentBranchCells = 20 // the agent's task gets what's left; a test keeps it readable
)

// Kind is a sort of place to go. Its string is the group key, and what a
// user types to narrow to it, so it is singular.
type Kind string

const (
	// KindWorkspace is a Herdr workspace: a set of tabs and panes, usually
	// rooted in one git checkout.
	KindWorkspace Kind = "workspace"
	// KindAgent is a pane in which Herdr has detected a coding agent.
	KindAgent Kind = "agent"
	// KindWorktree is a git checkout of a repository Herdr has a workspace
	// in, not yet open as a workspace itself. Going there opens one.
	KindWorktree Kind = "worktree"
	// KindDirectory is a zoxide directory that none of the above cover.
	KindDirectory Kind = "directory"
)

// Destination is one place the picker can take you. Which fields are set
// depends on Kind. DisplayPath is shortened for display; opening always
// uses the full path its source supplied.
type Destination struct {
	Kind Kind

	Workspace herdr.WorkspaceID // workspace
	Pane      herdr.PaneID      // agent
	Name      string            // agent
	Status    herdr.AgentStatus // workspace, agent
	Focused   bool              // workspace
	Task      string            // agent

	// Repo is the repository's name, empty when there is none. RepoRoot is
	// set for worktrees, which open against it.
	Repo     string
	RepoRoot string
	// Branch is the checked-out branch. A workspace outside git shows its
	// label here instead, so the column still says which one it is.
	Branch string

	Path        string // worktree, directory
	DisplayPath string // workspace, worktree, directory
}

// entry is a Destination as the picker draws it, in Herdr's colours.
type entry struct {
	Destination
	theme theme.Theme
}

func entries(ds []Destination, t theme.Theme) []entry {
	out := make([]entry, len(ds))
	for i, d := range ds {
		out[i] = entry{d, t}
	}
	return out
}

func (e entry) Group() string { return string(e.Kind) }

// HiddenTerms are worth typing but not worth a column. The kind is drawn
// only as a divider and a status only as a glyph, neither searchable, so
// both are repeated here: "'agent 'working" narrows to busy agents. Ids are
// how you get back to a workspace you remember by number.
func (e entry) HiddenTerms() string {
	switch e.Kind {
	case KindWorkspace:
		return string(e.Kind) + " " + string(e.Status) + " " + string(e.Workspace)
	case KindAgent:
		return string(e.Kind) + " " + string(e.Status) + " " + string(e.Pane)
	default:
		return string(e.Kind)
	}
}

// Fields returns one field per column of the destination's group; see
// groups. A kind with a declared group but no case here has no fields, so
// Build fails with ErrArity rather than drawing it as something else.
func (e entry) Fields() []picker.Field {
	t := e.theme
	switch e.Kind {
	case KindWorkspace:
		mark := ""
		if e.Focused {
			mark = "←"
		}
		return []picker.Field{
			statusGlyph(e.Status, t),
			picker.Text(orDash(e.Repo), t.Text),
			picker.Text(e.Branch, t.Blue),
			picker.Text(e.DisplayPath, t.Muted),
			picker.Tag(mark, t.Accent),
		}
	case KindAgent:
		// No status column: the glyph carries it in shape and colour, and
		// spelling it out would cost the task title beside it.
		return []picker.Field{
			statusGlyph(e.Status, t),
			picker.Text(e.Name, t.Text),
			picker.Text(orDash(e.Repo), t.Muted),
			picker.Text(e.Branch, t.Blue),
			picker.Text(e.Task, t.Text),
		}
	case KindWorktree:
		return []picker.Field{
			picker.Tag("", t.Muted),
			picker.Text(orDash(e.Repo), t.Text),
			picker.Text(e.Branch, t.Blue),
			picker.Text(e.DisplayPath, t.Muted),
			picker.Tag("", t.Accent),
		}
	case KindDirectory:
		// A directory has no repo or branch until something opens it, and
		// its basename is no substitute: under a repo column every
		// wt/<repo>/main would read as a repo called "main". So it shows
		// just its path.
		return []picker.Field{
			picker.Tag("", t.Muted),
			picker.Text(e.DisplayPath, t.Text),
		}
	}
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// statusGlyph is the glyph and colour Herdr's sidebar draws for an agent
// status, in the indicator set Herdr is configured with.
func statusGlyph(s herdr.AgentStatus, t theme.Theme) picker.Field {
	dot, symbol, fg := "·", "·", t.Muted
	switch s {
	case herdr.AgentBlocked:
		dot, symbol, fg = "●", "×", t.Red
	case herdr.AgentWorking:
		dot, symbol, fg = "●", "◐", t.Yellow
	case herdr.AgentDone:
		dot, symbol, fg = "●", "✓", t.Teal
	case herdr.AgentIdle:
		dot, symbol, fg = "○", "○", t.Green
	}
	if t.Indicators == theme.Symbols {
		return picker.Tag(symbol, fg)
	}
	return picker.Tag(dot, fg)
}

// groups are the picker's groups in display order: what's live (workspaces
// and agents), then worktrees that could be, then zoxide's directories,
// which stay hidden until the query starts with '/'.
func groups() []picker.Group {
	repoColumns := func(k Kind, label string) picker.Group {
		return picker.Group{Key: string(k), Label: label, Columns: []picker.Column{
			picker.Fixed(glyphCells), picker.Fixed(repoCells), picker.Fixed(branchCells), picker.Fill(), picker.Fixed(markCells),
		}}
	}
	return []picker.Group{
		repoColumns(KindWorkspace, "workspaces"),
		{Key: string(KindAgent), Label: "agents", Columns: []picker.Column{
			picker.Fixed(glyphCells), picker.Fixed(agentNameCells), picker.Fixed(agentRepoCells), picker.Fixed(agentBranchCells), picker.Fill(),
		}},
		repoColumns(KindWorktree, "worktrees"),
		{Key: string(KindDirectory), Label: "directories", Sigil: '/', Columns: []picker.Column{
			picker.Fixed(glyphCells), picker.Fill(),
		}},
	}
}

// palette is the picker's own colours, taken from Herdr's theme.
func palette(t theme.Theme) picker.Palette {
	return picker.Palette{
		Background: t.Background,
		Selection:  t.Selection,
		Prompt:     t.Blue,
		Query:      t.Text,
		Accent:     t.Accent,
		Muted:      t.Muted,
		Matched:    t.Matched,
	}
}

package main

import (
	"github.com/tomgeorge/go-herdrkit/herdr"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/picker"
	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

// Column widths, in cells. Workspaces and worktrees share a set because
// they're the same thing in two states, and a query mixes the groups back
// together.
const (
	glyphCells       = 2
	repoCells        = 14
	branchCells      = 24
	markCells        = 2
	agentNameCells   = 16
	agentRepoCells   = 13
	agentBranchCells = 20
)

// agentFixedCells is what the agent group spends before its task column
// gets anything. The popup width in herdr-plugin.toml has to clear it by
// enough to leave a task readable; a test checks that.
const agentFixedCells = glyphCells + agentNameCells + agentRepoCells + agentBranchCells

// Kind is a sort of place to go. Its string is the group key, and what a
// user types to narrow to it, so it is singular.
type Kind string

const (
	KindWorkspace Kind = "workspace"
	KindAgent     Kind = "agent"
	KindWorktree  Kind = "worktree"
	KindDirectory Kind = "directory"
)

// Destination is one place the picker can take you. Which fields are set
// depends on Kind. DisplayPath is shortened for display; dispatch always
// uses the full path Herdr supplied.
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
	Branch   string

	Path        string // worktree, directory
	DisplayPath string // workspace, worktree, directory
}

func (d Destination) Group() string { return string(d.Kind) }

func (d Destination) Cells(t theme.Theme) []picker.Cell {
	switch d.Kind {
	case KindWorkspace:
		mark := ""
		if d.Focused {
			mark = "←"
		}
		return []picker.Cell{
			glyph(d.Status, t),
			picker.Text(repoName(d.Repo), t.Strong),
			picker.Text(d.Branch, t.Blue),
			picker.Text(d.DisplayPath, t.Muted),
			picker.Tag(mark, t.Accent),
		}
	case KindAgent:
		// No status column: the glyph carries it in shape and colour, and
		// spelling it out would cost the task title beside it.
		return []picker.Cell{
			glyph(d.Status, t),
			picker.Text(d.Name, t.Strong),
			picker.Text(repoName(d.Repo), t.Muted),
			picker.Text(d.Branch, t.Blue),
			picker.Text(d.Task, t.Strong),
		}
	case KindWorktree:
		return []picker.Cell{
			picker.Tag("", t.Muted),
			picker.Text(repoName(d.Repo), t.Strong),
			picker.Text(d.Branch, t.Blue),
			picker.Text(d.DisplayPath, t.Muted),
			picker.Tag("", t.Accent),
		}
	default:
		// A directory has no repo or branch until something opens it, and its
		// basename is no substitute: under a repo column every wt/<repo>/main
		// would read as a repo called "main". The path is the honest field.
		return []picker.Cell{
			picker.Tag("", t.Muted),
			picker.Text(d.DisplayPath, t.Strong),
		}
	}
}

// HiddenTerms are worth typing but not worth a column. The kind is drawn
// only as a divider and an agent's status only as a glyph, neither
// searchable, so both are repeated here: "'agent 'working" narrows to busy
// agents. Ids are how you get back to a workspace you remember by number.
func (d Destination) HiddenTerms() string {
	switch d.Kind {
	case KindWorkspace:
		return string(d.Kind) + " " + string(d.Workspace)
	case KindAgent:
		return string(d.Kind) + " " + string(d.Status) + " " + string(d.Pane)
	default:
		return string(d.Kind)
	}
}

func repoName(name string) string {
	if name == "" {
		return "-"
	}
	return name
}

func glyph(s herdr.AgentStatus, t theme.Theme) picker.Cell {
	g, c := t.Status(s)
	return picker.Tag(g, c)
}

// groups are the picker's groups in display order: live state first, then
// what could be live, then everywhere else, which waits behind '/'.
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
		{Key: string(KindDirectory), Label: "directories", Scope: '/', Columns: []picker.Column{
			picker.Fixed(glyphCells), picker.Fill(),
		}},
	}
}

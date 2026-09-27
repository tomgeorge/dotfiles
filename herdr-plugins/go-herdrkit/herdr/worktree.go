package herdr

import "context"

// Worktree is one git worktree of a repository.
type Worktree struct {
	Path             string
	Label            string
	Branch           string // empty when detached or bare
	IsBare           bool
	IsDetached       bool
	IsPrunable       bool
	IsLinkedWorktree bool
	// OpenWorkspaceID is the workspace already open on this worktree, if any.
	OpenWorkspaceID WorkspaceID
}

// Openable reports whether opening the worktree would make a new workspace:
// it is a real checkout that still exists and nothing has it open.
func (w Worktree) Openable() bool {
	return !w.IsBare && !w.IsPrunable && w.OpenWorkspaceID == ""
}

// BranchLabel is the branch to show for the worktree.
func (w Worktree) BranchLabel() string {
	switch {
	case w.IsDetached:
		return "(detached)"
	case w.Branch == "":
		return "-"
	default:
		return w.Branch
	}
}

// WorktreeSource is the repository a worktree listing came from.
type WorktreeSource struct {
	Repository         Repository
	SourceCheckoutPath string
	SourceWorkspaceID  WorkspaceID // empty when no workspace asked
}

// WorktreeList is every worktree of one repository.
type WorktreeList struct {
	Source    WorktreeSource
	Worktrees []Worktree
}

// ListWorktrees lists the worktrees of the repository containing cwd.
func (c *Client) ListWorktrees(ctx context.Context, cwd string) (WorktreeList, error) {
	params := struct {
		Cwd string `json:"cwd"`
	}{cwd}
	return call[worktreeListWire, WorktreeList](ctx, c, "worktree.list", "worktree_list", params, DefaultTimeout)
}

// WorktreeOpened is what OpenWorktree focused or made.
type WorktreeOpened struct {
	Workspace WorkspaceInfo
	Tab       TabInfo
	RootPane  PaneInfo
	Worktree  Worktree
	// AlreadyOpen is true when an existing workspace was reused.
	AlreadyOpen bool
}

// OpenWorktree opens the checkout at path, a worktree of the repository at
// repoRoot, reusing its workspace if one is already open. The two differ:
// Herdr resolves the worktree list from repoRoot.
func (c *Client) OpenWorktree(ctx context.Context, repoRoot, path string, focus bool) (WorktreeOpened, error) {
	params := struct {
		Cwd   string `json:"cwd"`
		Path  string `json:"path"`
		Focus bool   `json:"focus"`
	}{repoRoot, path, focus}
	return call[worktreeOpenedWire, WorktreeOpened](ctx, c, "worktree.open", "worktree_opened", params, DefaultTimeout)
}

type worktreeListWire struct {
	Source *struct {
		RepoKey            *string `json:"repo_key"`
		RepoName           *string `json:"repo_name"`
		RepoRoot           *string `json:"repo_root"`
		SourceCheckoutPath *string `json:"source_checkout_path"`
		SourceWorkspaceID  *string `json:"source_workspace_id"`
	} `json:"source"`
	Worktrees *[]worktreeWire `json:"worktrees"`
}

func (w worktreeListWire) result(method string) (WorktreeList, error) {
	s := w.Source
	if s == nil {
		return WorktreeList{}, missing(method, "source")
	}
	for _, f := range []struct {
		name   string
		absent bool
	}{
		{"repo_key", s.RepoKey == nil},
		{"repo_name", s.RepoName == nil},
		{"repo_root", s.RepoRoot == nil},
		{"source_checkout_path", s.SourceCheckoutPath == nil},
	} {
		if f.absent {
			return WorktreeList{}, missing(method, "source."+f.name)
		}
	}
	if w.Worktrees == nil {
		return WorktreeList{}, missing(method, "worktrees")
	}
	out := WorktreeList{
		Source: WorktreeSource{
			Repository:         Repository{Key: *s.RepoKey, Name: *s.RepoName, Root: *s.RepoRoot},
			SourceCheckoutPath: *s.SourceCheckoutPath,
			SourceWorkspaceID:  WorkspaceID(deref(s.SourceWorkspaceID)),
		},
		Worktrees: make([]Worktree, 0, len(*w.Worktrees)),
	}
	for _, wt := range *w.Worktrees {
		info, err := wt.info(method, "worktrees[].")
		if err != nil {
			return WorktreeList{}, err
		}
		out.Worktrees = append(out.Worktrees, info)
	}
	return out, nil
}

type worktreeWire struct {
	Path             *string `json:"path"`
	Label            *string `json:"label"`
	Branch           *string `json:"branch"`
	IsBare           *bool   `json:"is_bare"`
	IsDetached       *bool   `json:"is_detached"`
	IsPrunable       *bool   `json:"is_prunable"`
	IsLinkedWorktree *bool   `json:"is_linked_worktree"`
	OpenWorkspaceID  *string `json:"open_workspace_id"`
}

func (w worktreeWire) info(method, prefix string) (Worktree, error) {
	for _, f := range []struct {
		name   string
		absent bool
	}{
		{"path", w.Path == nil},
		{"label", w.Label == nil},
		{"is_bare", w.IsBare == nil},
		{"is_detached", w.IsDetached == nil},
		{"is_prunable", w.IsPrunable == nil},
		{"is_linked_worktree", w.IsLinkedWorktree == nil},
	} {
		if f.absent {
			return Worktree{}, missing(method, prefix+f.name)
		}
	}
	return Worktree{
		Path:             *w.Path,
		Label:            *w.Label,
		Branch:           deref(w.Branch),
		IsBare:           *w.IsBare,
		IsDetached:       *w.IsDetached,
		IsPrunable:       *w.IsPrunable,
		IsLinkedWorktree: *w.IsLinkedWorktree,
		OpenWorkspaceID:  WorkspaceID(deref(w.OpenWorkspaceID)),
	}, nil
}

type worktreeOpenedWire struct {
	Workspace   *workspaceInfoWire `json:"workspace"`
	Tab         *tabInfoWire       `json:"tab"`
	RootPane    *paneInfoWire      `json:"root_pane"`
	Worktree    *worktreeWire      `json:"worktree"`
	AlreadyOpen *bool              `json:"already_open"`
}

func (w worktreeOpenedWire) result(method string) (WorktreeOpened, error) {
	switch {
	case w.Workspace == nil:
		return WorktreeOpened{}, missing(method, "workspace")
	case w.Tab == nil:
		return WorktreeOpened{}, missing(method, "tab")
	case w.RootPane == nil:
		return WorktreeOpened{}, missing(method, "root_pane")
	case w.Worktree == nil:
		return WorktreeOpened{}, missing(method, "worktree")
	case w.AlreadyOpen == nil:
		return WorktreeOpened{}, missing(method, "already_open")
	}
	ws, err := w.Workspace.info(method, "workspace.")
	if err != nil {
		return WorktreeOpened{}, err
	}
	tab, err := w.Tab.info(method, "tab.")
	if err != nil {
		return WorktreeOpened{}, err
	}
	pane, err := w.RootPane.info(method, "root_pane.")
	if err != nil {
		return WorktreeOpened{}, err
	}
	wt, err := w.Worktree.info(method, "worktree.")
	if err != nil {
		return WorktreeOpened{}, err
	}
	return WorktreeOpened{Workspace: ws, Tab: tab, RootPane: pane, Worktree: wt, AlreadyOpen: *w.AlreadyOpen}, nil
}

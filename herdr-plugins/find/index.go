package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"unicode/utf8"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// api is the part of the Herdr client find uses; tests fake it.
type api interface {
	Snapshot(ctx context.Context) (herdr.Snapshot, error)
	ListWorktrees(ctx context.Context, cwd string) (herdr.WorktreeList, error)
	FocusWorkspace(ctx context.Context, ws herdr.WorkspaceID) (herdr.WorkspaceInfo, error)
	FocusAgent(ctx context.Context, pane herdr.PaneID) (herdr.AgentInfo, error)
	OpenWorktree(ctx context.Context, repoRoot, path string, focus bool) (herdr.WorktreeOpened, error)
	CreateWorkspace(ctx context.Context, cwd, label string, focus bool) (herdr.WorkspaceCreated, error)
}

// Sources is everything the index is built from, in one value, so building
// destinations is a pure function over a fixture.
type Sources struct {
	Snapshot herdr.Snapshot
	// Worktrees has one listing per repository Herdr holds a workspace in. A
	// repository with nothing open is reachable only as a directory.
	Worktrees []herdr.WorktreeList
	// Dirs are zoxide's directories, in frecency order.
	Dirs []string
}

// collect reads every source. Losing one repository's worktrees or zoxide
// costs just those rows, but says so on log: otherwise a socket failure
// reads as "this repo has no worktrees" forever.
func collect(ctx context.Context, c api, zoxide string, log io.Writer) (Sources, error) {
	snap, err := c.Snapshot(ctx)
	if err != nil {
		return Sources{}, fmt.Errorf("reading the session: %w", err)
	}
	s := Sources{Snapshot: snap}
	for _, root := range snap.RepositoryRoots() {
		list, err := c.ListWorktrees(ctx, root)
		if err != nil {
			_, _ = fmt.Fprintf(log, "find: leaving out the worktrees of %s: %v\n", root, err)
			continue
		}
		s.Worktrees = append(s.Worktrees, list)
	}
	if s.Dirs, err = zoxideDirs(ctx, zoxide); err != nil {
		_, _ = fmt.Fprintf(log, "find: leaving out zoxide directories: %v\n", err)
	}
	return s, nil
}

func zoxideDirs(ctx context.Context, program string) ([]string, error) {
	out, err := exec.CommandContext(ctx, program, "query", "-l").Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return nil, fmt.Errorf("%s query -l failed with %v: %s", program, exit, strings.TrimSpace(string(exit.Stderr)))
		}
		return nil, fmt.Errorf("running %s query -l: %w", program, err)
	}
	return parseZoxide(out)
}

func parseZoxide(out []byte) ([]string, error) {
	if !utf8.Valid(out) {
		return nil, errors.New("zoxide query output was not valid UTF-8")
	}
	var dirs []string
	for line := range strings.Lines(string(out)) {
		if line = strings.TrimSuffix(line, "\n"); line != "" {
			dirs = append(dirs, line)
		}
	}
	return dirs, nil
}

type repoBranch struct{ repo, branch string }

// Destinations turns the sources into rows, in source order within each
// kind. home shortens paths for display.
func (s Sources) Destinations(home string) []Destination {
	// A workspace knows its checkout but not its branch; the branch comes
	// from the worktree listing, joined on the checkout path.
	branches := map[string]string{}
	for _, list := range s.Worktrees {
		for _, wt := range list.Worktrees {
			if wt.Branch != "" {
				branches[wt.Path] = wt.Branch
			}
		}
	}

	var out []Destination
	byWorkspace := map[herdr.WorkspaceID]repoBranch{}
	for _, ws := range s.Snapshot.Workspaces {
		var repo, checkout string
		if ws.Worktree != nil {
			repo, checkout = ws.Worktree.Repository.Name, ws.Worktree.CheckoutPath
		}
		branch, ok := branches[checkout]
		if !ok || checkout == "" {
			branch = ws.Label
		}
		path := checkout
		if path == "" {
			path = s.Snapshot.EffectiveWorkspaceDir(ws.WorkspaceID)
		}
		byWorkspace[ws.WorkspaceID] = repoBranch{repo, branch}
		out = append(out, Destination{
			Kind:        KindWorkspace,
			Workspace:   ws.WorkspaceID,
			Repo:        repo,
			Branch:      branch,
			DisplayPath: tilde(path, home),
			Status:      ws.AgentStatus,
			Focused:     ws.Focused,
		})
	}

	for _, a := range s.Snapshot.Agents {
		rb, ok := byWorkspace[a.WorkspaceID]
		if !ok {
			rb.branch = "-"
		}
		out = append(out, Destination{
			Kind:   KindAgent,
			Pane:   a.PaneID,
			Name:   a.DisplayName(),
			Status: a.AgentStatus,
			Repo:   rb.repo,
			Branch: rb.branch,
			Task:   a.TerminalTitleStripped,
		})
	}

	// Openable leaves out worktrees already open as a workspace, so one
	// checkout isn't offered twice under two kinds.
	for _, list := range s.Worktrees {
		for _, wt := range list.Worktrees {
			if !wt.Openable() {
				continue
			}
			out = append(out, Destination{
				Kind:        KindWorktree,
				Path:        wt.Path,
				Repo:        list.Source.Repository.Name,
				RepoRoot:    list.Source.Repository.Root,
				Branch:      wt.BranchLabel(),
				DisplayPath: tilde(wt.Path, home),
			})
		}
	}

	// A directory already reachable above is dropped, so one place never
	// appears twice under two names.
	seen := s.reachable()
	for _, dir := range s.Dirs {
		if seen[dir] {
			continue
		}
		out = append(out, Destination{Kind: KindDirectory, Path: dir, DisplayPath: tilde(dir, home)})
	}
	return out
}

func (s Sources) reachable() map[string]bool {
	seen := map[string]bool{}
	for _, ws := range s.Snapshot.Workspaces {
		if ws.Worktree != nil {
			seen[ws.Worktree.CheckoutPath] = true
		}
		if dir := s.Snapshot.EffectiveWorkspaceDir(ws.WorkspaceID); dir != "" {
			seen[dir] = true
		}
	}
	for _, list := range s.Worktrees {
		for _, wt := range list.Worktrees {
			seen[wt.Path] = true
		}
	}
	return seen
}

// tilde shortens a path under home to ~/…, leaving a sibling that merely
// shares home's prefix (/home/developer vs /home/dev) alone.
func tilde(path, home string) string {
	switch {
	case home == "":
		return path
	case path == home:
		return "~"
	}
	if rest, ok := strings.CutPrefix(path, strings.TrimSuffix(home, "/")+"/"); ok {
		return "~/" + rest
	}
	return path
}

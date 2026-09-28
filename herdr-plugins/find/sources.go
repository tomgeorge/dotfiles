package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"path/filepath"
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

// Sources is everything the destinations are built from, in one value, so
// building them is a pure function over a fixture.
type Sources struct {
	Snapshot herdr.Snapshot
	// Worktrees has one listing per repository Herdr holds a workspace in. A
	// repository with nothing open is reachable only as a directory.
	Worktrees []herdr.WorktreeList
	// Dirs are zoxide's directories, in frecency order.
	Dirs []string
}

// collect reads every source. Only the snapshot is essential: losing one
// repository's worktrees, or zoxide, costs just those rows. It logs a
// warning, though, or a socket failure would read as "this repo has no
// worktrees" forever.
func collect(ctx context.Context, c api, zoxide string, log *slog.Logger) (Sources, error) {
	snap, err := c.Snapshot(ctx)
	if err != nil {
		return Sources{}, fmt.Errorf("reading the session: %w", err)
	}
	s := Sources{Snapshot: snap}
	for _, root := range snap.RepositoryRoots() {
		list, err := c.ListWorktrees(ctx, root)
		if err != nil {
			log.Warn("leaving out a repository's worktrees", "repo", root, "err", err)
			continue
		}
		s.Worktrees = append(s.Worktrees, list)
	}
	if s.Dirs, err = zoxideDirs(ctx, zoxide); err != nil {
		log.Warn("leaving out zoxide directories", "err", err)
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
//
// Herdr and zoxide can spell one directory differently, so checkouts are
// joined to their branches, and places deduplicated, by pathKey. Each
// destination keeps its path as its source spelled it.
func (s Sources) Destinations(home string) []Destination {
	// A workspace knows its checkout but not its branch; the branch comes
	// from the worktree listing, joined on the checkout path, and reads the
	// same as the worktree row would.
	branches := map[string]string{}
	for _, list := range s.Worktrees {
		for _, wt := range list.Worktrees {
			if wt.Branch != "" || wt.IsDetached {
				branches[pathKey(wt.Path)] = wt.BranchLabel()
			}
		}
	}

	var out []Destination
	// offered is every path a row already goes to, so no place is offered
	// twice under two kinds.
	offered := map[string]bool{}
	byWorkspace := map[herdr.WorkspaceID]repoBranch{}
	for _, ws := range s.Snapshot.Workspaces {
		var repo, checkout string
		if ws.Worktree != nil {
			repo, checkout = ws.Worktree.Repository.Name, ws.Worktree.CheckoutPath
		}
		branch, ok := branches[pathKey(checkout)]
		if !ok || checkout == "" {
			branch = ws.Label
		}
		path := s.Snapshot.EffectiveWorkspaceDir(ws.WorkspaceID) // the checkout, else a pane's cwd
		offered[pathKey(path)] = true
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

	// Openable leaves out bare and prunable entries, and checkouts already
	// open as a workspace.
	for _, list := range s.Worktrees {
		for _, wt := range list.Worktrees {
			if !wt.Openable() || offered[pathKey(wt.Path)] {
				continue
			}
			offered[pathKey(wt.Path)] = true
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

	for _, dir := range s.Dirs {
		if offered[pathKey(dir)] {
			continue
		}
		offered[pathKey(dir)] = true
		out = append(out, Destination{Kind: KindDirectory, Path: dir, DisplayPath: tilde(dir, home)})
	}
	return out
}

// pathKey is how paths are compared: cleaned, so "/src/dots/" and
// "/src/dots" are one place. It doesn't touch the filesystem, so a path and
// a symlink to it stay two places; open resolves those. Empty stays empty,
// not ".".
func pathKey(path string) string {
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
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

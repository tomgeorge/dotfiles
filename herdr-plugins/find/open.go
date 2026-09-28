package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// open takes the user to d. Errors name what was being opened.
func open(ctx context.Context, c api, d Destination) error {
	switch d.Kind {
	case KindWorkspace:
		if _, err := c.FocusWorkspace(ctx, d.Workspace); err != nil {
			return fmt.Errorf("focusing %s: %w", d.Workspace, err)
		}
	case KindAgent:
		// By pane, not name: two agents can share a name, and the pane is
		// what the user pointed at.
		if _, err := c.FocusAgent(ctx, d.Pane); err != nil {
			return fmt.Errorf("focusing the agent %s in %s: %w", d.Name, d.Pane, err)
		}
	case KindWorktree:
		// Focus-or-create against Herdr's own record of which workspace owns
		// the checkout, so no bookkeeping is needed here.
		if _, err := c.OpenWorktree(ctx, d.RepoRoot, d.Path, true); err != nil {
			return fmt.Errorf("opening the worktree at %s: %w", d.Path, err)
		}
	case KindDirectory:
		return openDir(ctx, c, d.Path)
	default:
		return fmt.Errorf("unknown destination kind %q", d.Kind)
	}
	return nil
}

// openDir opens a directory, which has no identity in Herdr's API until
// something opens it: a checkout as a worktree, else the workspace already
// sitting in it, else a new workspace.
func openDir(ctx context.Context, c api, path string) error {
	dir, err := resolve(path)
	if err != nil {
		return fmt.Errorf("resolving %s: %w", path, err)
	}
	if info, err := os.Stat(dir); err != nil {
		return fmt.Errorf("resolving %s: %w", path, err)
	} else if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}

	// .git is exactly the test for a checkout root: a directory in the main
	// checkout, a file in a linked worktree, absent in a subdirectory (where
	// OpenWorktree would pick the wrong root). Stat, so a .git symlink counts
	// by what it points to, and a dangling one as no checkout.
	_, err = os.Stat(filepath.Join(dir, ".git"))
	switch {
	case err == nil:
		// The checkout serves as its own repo root: Herdr finds the
		// repository from any checkout of it.
		if _, err := c.OpenWorktree(ctx, dir, dir, true); err != nil {
			return fmt.Errorf("opening a workspace for %s: %w", dir, err)
		}
		return nil
	case !errors.Is(err, fs.ErrNotExist):
		return fmt.Errorf("checking whether %s is a git checkout: %w", dir, err)
	}

	snap, err := c.Snapshot(ctx)
	if err != nil {
		return fmt.Errorf("reading the session: %w", err)
	}
	for _, p := range snap.Panes {
		if p.Cwd == "" {
			continue
		}
		// Resolved too, so a pane that got there through a symlink counts.
		// A cwd that no longer resolves just isn't a match.
		if cwd, err := resolve(p.Cwd); err == nil && cwd == dir {
			if _, err := c.FocusWorkspace(ctx, p.WorkspaceID); err != nil {
				return fmt.Errorf("focusing the workspace already in %s: %w", dir, err)
			}
			return nil
		}
	}
	if _, err := c.CreateWorkspace(ctx, dir, filepath.Base(dir), true); err != nil {
		return fmt.Errorf("creating a workspace for %s: %w", dir, err)
	}
	return nil
}

// resolve is path's absolute, symlink-free form: one spelling per directory.
func resolve(path string) (string, error) {
	dir, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	return filepath.Abs(dir)
}

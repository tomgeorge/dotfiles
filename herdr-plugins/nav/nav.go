package main

import (
	"cmp"
	"context"
	"fmt"
	"io"
	"slices"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// herdrAPI is the slice of *herdr.Client nav uses; tests substitute a fake.
type herdrAPI interface {
	ProcessInfo(ctx context.Context, pane herdr.PaneID) (herdr.ProcessInfo, error)
	SendKeys(ctx context.Context, pane herdr.PaneID, keys ...string) error
	FocusDirection(ctx context.Context, pane herdr.PaneID, dir herdr.Direction) (herdr.FocusResult, error)
	ListWorkspaces(ctx context.Context) ([]herdr.WorkspaceInfo, error)
	ListTabs(ctx context.Context, workspace herdr.WorkspaceID) ([]herdr.TabInfo, error)
	FocusTab(ctx context.Context, tab herdr.TabID) (herdr.TabInfo, error)
}

// navigator moves focus from one pane/tab, handing off to the outer
// terminal (WezTerm) past herdr's edge.
//
// An empty pane means "whatever the server has focused now", and tab moves
// always start from the server's focus. Keybinding actions use that rather
// than the ids herdr passes them: those are the client's view, which lags,
// so a fast second key would start from where the first began.
type navigator struct {
	api   herdrAPI
	outer Outer
	pane  herdr.PaneID
	log   io.Writer // non-fatal problems; herdr keeps stderr in the plugin log
}

// action is what to do with a directional key.
type action int

const (
	moveFocus action = iota
	forwardKey
)

// decide says whether the program in front of the pane wants the key itself.
func decide(dir herdr.Direction, info herdr.ProcessInfo) action {
	if info.Find(herdr.AcceptsVimNavigation) != nil {
		return forwardKey
	}
	// fzf uses ctrl+j/k to move the selection; ctrl+h/l only edit the query,
	// so those still move between panes.
	if (dir == herdr.Up || dir == herdr.Down) && info.Find(herdr.IsFzf) != nil {
		return forwardKey
	}
	return moveFocus
}

var chords = map[herdr.Direction]string{
	herdr.Left:  "ctrl+h",
	herdr.Down:  "ctrl+j",
	herdr.Up:    "ctrl+k",
	herdr.Right: "ctrl+l",
}

// paneMove moves focus one pane in dir. With forward set (the key came from
// a herdr binding) a program that handles the key itself gets it instead.
// forward is false when that program already declined it: nvim at its own
// edge, which would otherwise get the key back and loop.
func (n navigator) paneMove(ctx context.Context, dir herdr.Direction, forward bool) error {
	if forward {
		info, err := n.api.ProcessInfo(ctx, n.pane)
		if err != nil {
			// Moving focus is the better failure than swallowing the key.
			_, _ = fmt.Fprintf(n.log, "process info: %v; moving focus\n", err)
		} else if decide(dir, info) == forwardKey {
			// info.PaneID, not n.pane: with n.pane empty the server picked
			// the pane, and send_keys needs it named.
			return n.api.SendKeys(ctx, info.PaneID, chords[dir])
		}
	}
	r, err := n.api.FocusDirection(ctx, n.pane, dir)
	if err != nil {
		return err
	}
	if !r.Changed && r.Reason == herdr.FocusNoNeighbor {
		return n.outer.PaneDirection(ctx, dir)
	}
	return nil
}

// tabMove steps through tabs in sidebar order across workspaces: past a
// workspace's last tab to the next workspace's first, past its first to
// the previous workspace's last. Past the first or last workspace it hands
// off to the outer terminal. delta is +1 or -1.
func (n navigator) tabMove(ctx context.Context, delta int) error {
	wss, err := n.api.ListWorkspaces(ctx)
	if err != nil {
		return err
	}
	wss = slices.SortedFunc(slices.Values(wss), func(a, b herdr.WorkspaceInfo) int { return cmp.Compare(a.Number, b.Number) })
	i := slices.IndexFunc(wss, func(w herdr.WorkspaceInfo) bool { return w.Focused })
	if i < 0 {
		return fmt.Errorf("no workspace is focused")
	}

	tabs, err := n.api.ListTabs(ctx, wss[i].WorkspaceID)
	if err != nil {
		return err
	}
	next, ok, err := nextTab(tabs, wss[i].ActiveTabID, delta)
	if err != nil {
		return err
	}
	if ok {
		_, err = n.api.FocusTab(ctx, next)
		return err
	}

	// tab.focus switches workspace too.
	for j := i + delta; j >= 0 && j < len(wss); j += delta {
		tabs, err := n.api.ListTabs(ctx, wss[j].WorkspaceID)
		if err != nil {
			return err
		}
		if len(tabs) == 0 {
			continue
		}
		tabs = slices.SortedFunc(slices.Values(tabs), func(a, b herdr.TabInfo) int { return cmp.Compare(a.Number, b.Number) })
		target := tabs[0]
		if delta < 0 {
			target = tabs[len(tabs)-1]
		}
		_, err = n.api.FocusTab(ctx, target.TabID)
		return err
	}
	return n.outer.Tab(ctx, delta)
}

// nextTab returns the tab delta places from current in number order, or
// ok=false when that runs off either end. current falls back to the focused
// tab when empty or not in the list.
func nextTab(tabs []herdr.TabInfo, current herdr.TabID, delta int) (herdr.TabID, bool, error) {
	tabs = slices.SortedFunc(slices.Values(tabs), func(a, b herdr.TabInfo) int { return cmp.Compare(a.Number, b.Number) })
	i := slices.IndexFunc(tabs, func(t herdr.TabInfo) bool { return t.TabID == current })
	if i < 0 {
		i = slices.IndexFunc(tabs, func(t herdr.TabInfo) bool { return t.Focused })
	}
	if i < 0 {
		return "", false, fmt.Errorf("tab %q not found and no tab is focused", current)
	}
	j := i + delta
	if j < 0 || j >= len(tabs) {
		return "", false, nil
	}
	return tabs[j].TabID, true, nil
}

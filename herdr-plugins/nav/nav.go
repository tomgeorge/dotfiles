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

// navigator moves focus between panes and tabs, handing off to the outer
// terminal (WezTerm) past herdr's edge.
//
// Keybinding actions start from the server's focus, not the ids herdr passes
// them: those are the client's view, which lags, so a fast second key would
// start from where the first began.
type navigator struct {
	api   herdrAPI
	outer Outer
	moves moveLog
	log   io.Writer // non-fatal problems; herdr keeps stderr in the plugin log
}

// moveLog remembers the pane nav last moved focus to; *navLock is one.
type moveLog interface {
	lastMove() herdr.PaneID
	recordMove(pane herdr.PaneID)
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

// key handles a directional key from a herdr binding: the program in the
// focused pane gets it if it wants it, otherwise focus moves.
func (n navigator) key(ctx context.Context, dir herdr.Direction) error {
	info, err := n.api.ProcessInfo(ctx, "")
	if err != nil {
		// Moving focus is the better failure than swallowing the key.
		_, _ = fmt.Fprintf(n.log, "process info: %v; moving focus\n", err)
		return n.move(ctx, "", dir)
	}
	return n.keyAt(ctx, info, dir)
}

// keyAt is key with the focused pane already looked up. Every step names
// that pane, so a focus change in between (a click, another client) can't
// make the check and the action refer to different panes.
func (n navigator) keyAt(ctx context.Context, info herdr.ProcessInfo, dir herdr.Direction) error {
	if decide(dir, info) == forwardKey {
		// Any edge call this leads to starts from info.PaneID; an older
		// record could only make a stale one look current (see edge).
		n.moves.recordMove("")
		return n.api.SendKeys(ctx, info.PaneID, chords[dir])
	}
	return n.move(ctx, info.PaneID, dir)
}

// edge handles nvim in origin finding no window in dir. nvim hands off
// asynchronously, after herdr-nav forwarded it the key and let go of the
// lock, so by now focus may have moved on:
//
//   - Still on origin: move from there.
//   - On the pane nav last moved to: an earlier key in the same burst (two
//     ctrl+h's both forwarded to nvim before either handed off) moved it.
//     Carry on from there, as the key would have if it had arrived later.
//   - Anywhere else: the user moved (a click, herdr's own keys). Applying the
//     key there would jump somewhere they didn't ask for, so drop it.
func (n navigator) edge(ctx context.Context, origin herdr.PaneID, dir herdr.Direction) error {
	if origin == "" {
		// Not started from a herdr pane; nothing to check against.
		return n.move(ctx, "", dir)
	}
	info, err := n.api.ProcessInfo(ctx, "")
	if err != nil {
		_, _ = fmt.Fprintf(n.log, "process info: %v; moving from %s\n", err, origin)
		return n.move(ctx, origin, dir)
	}
	switch focused := info.PaneID; {
	case focused == origin:
		return n.move(ctx, origin, dir)
	case focused == n.moves.lastMove():
		_, _ = fmt.Fprintf(n.log, "nav moved focus from %s to %s before nvim handed off; continuing from there\n", origin, focused)
		return n.keyAt(ctx, info, dir)
	default:
		_, _ = fmt.Fprintf(n.log, "focus moved from %s to %s since nvim got the key; dropping it\n", origin, focused)
		return nil
	}
}

// move moves focus one pane in dir from pane ("" for the server's focus),
// handing off to the outer terminal at herdr's edge.
func (n navigator) move(ctx context.Context, pane herdr.PaneID, dir herdr.Direction) error {
	r, err := n.api.FocusDirection(ctx, pane, dir)
	if err != nil {
		n.moves.recordMove("")
		return err
	}
	if r.Changed {
		n.moves.recordMove(r.FocusedPaneID)
		return nil
	}
	n.moves.recordMove("")
	if r.Reason == herdr.FocusNoNeighbor {
		return n.outer.PaneDirection(ctx, dir)
	}
	return nil
}

// tabMove steps through tabs in sidebar order across workspaces: past a
// workspace's last tab to the next workspace's first, past its first to
// the previous workspace's last. Past the first or last workspace it hands
// off to the outer terminal. delta is +1 or -1.
func (n navigator) tabMove(ctx context.Context, delta int) error {
	// Whatever happens, focus isn't on a pane nav moved to.
	n.moves.recordMove("")
	wss, err := n.api.ListWorkspaces(ctx)
	if err != nil {
		return err
	}
	wss = sidebarOrder(wss)
	i := slices.IndexFunc(wss, func(w herdr.WorkspaceInfo) bool { return w.Focused })
	if i < 0 {
		return fmt.Errorf("no workspace is focused")
	}

	tabs, err := n.api.ListTabs(ctx, wss[i].WorkspaceID)
	if err != nil {
		return err
	}
	// Not ok also when the current tab can't be placed (the workspace is
	// mid-change): moving on to the neighbouring workspace beats failing.
	if next, ok := nextTab(tabs, wss[i].ActiveTabID, delta); ok {
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
// tab when empty or not in the list; with neither, ok is false.
func nextTab(tabs []herdr.TabInfo, current herdr.TabID, delta int) (herdr.TabID, bool) {
	tabs = slices.SortedFunc(slices.Values(tabs), func(a, b herdr.TabInfo) int { return cmp.Compare(a.Number, b.Number) })
	i := slices.IndexFunc(tabs, func(t herdr.TabInfo) bool { return t.TabID == current })
	if i < 0 {
		i = slices.IndexFunc(tabs, func(t herdr.TabInfo) bool { return t.Focused })
	}
	if i < 0 {
		return "", false
	}
	j := i + delta
	if j < 0 || j >= len(tabs) {
		return "", false
	}
	return tabs[j].TabID, true
}

// sidebarOrder sorts workspaces the way Herdr's sidebar lists them, which is
// also the order Herdr's own next/previous-workspace keys walk. It's number
// order, except that a worktree group is drawn as one block where its first
// member falls: the parent (the repo's main checkout), then its linked
// worktrees in number order. Worktrees are numbered when created, so without
// this a worktree made after other workspaces would be visited last, not
// under its parent.
//
// A run of workspaces with the same repository is a group only when it has
// two or more members and one of them is a main checkout, as in Herdr 0.9.1's
// workspace_entries (src/client/shell/sidebar.rs). Collapsed groups live in
// the Herdr client, out of the API's reach, so every group counts as
// expanded.
func sidebarOrder(wss []herdr.WorkspaceInfo) []herdr.WorkspaceInfo {
	wss = slices.SortedFunc(slices.Values(wss), func(a, b herdr.WorkspaceInfo) int { return cmp.Compare(a.Number, b.Number) })
	members := map[string][]int{}
	for i, w := range wss {
		if w.Worktree != nil {
			k := w.Worktree.Repository.Key
			members[k] = append(members[k], i)
		}
	}
	isMain := func(i int) bool { return !wss[i].Worktree.IsLinkedWorktree }
	grouped := func(k string) bool {
		return len(members[k]) >= 2 && slices.ContainsFunc(members[k], isMain)
	}

	out := make([]herdr.WorkspaceInfo, 0, len(wss))
	emitted := map[string]bool{}
	for i, w := range wss {
		if w.Worktree == nil || !grouped(w.Worktree.Repository.Key) {
			out = append(out, w)
			continue
		}
		k := w.Worktree.Repository.Key
		if emitted[k] {
			continue
		}
		emitted[k] = true
		parent := i
		if j := slices.IndexFunc(members[k], isMain); j >= 0 {
			parent = members[k][j]
		}
		out = append(out, wss[parent])
		for _, m := range members[k] {
			if m != parent {
				out = append(out, wss[m])
			}
		}
	}
	return out
}

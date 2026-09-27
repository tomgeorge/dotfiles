package main

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/tomgeorge/go-herdrkit/herdr"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/picker"
	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

const home = "/home/dev"

var (
	dots    = herdr.Repository{Key: "/home/dev/src/dots", Name: "dots", Root: "/home/dev/src/dots"}
	service = herdr.Repository{Key: "/home/dev/src/service", Name: "service", Root: "/home/dev/src/service"}
)

// sources is a session with a plain workspace, one on a repo's main
// checkout, one on a linked worktree, an agent in each of the last two, and
// zoxide directories that overlap all of them.
func sources() Sources {
	return Sources{
		Snapshot: herdr.Snapshot{
			Workspaces: []herdr.WorkspaceInfo{
				{WorkspaceID: "w1", Label: "~", AgentStatus: herdr.AgentUnknown},
				{WorkspaceID: "w2", Label: "dots", Focused: true, AgentStatus: herdr.AgentWorking,
					Worktree: &herdr.WorkspaceWorktree{Repository: dots, CheckoutPath: "/home/dev/src/dots"}},
				{WorkspaceID: "w3", Label: "service", AgentStatus: herdr.AgentBlocked,
					Worktree: &herdr.WorkspaceWorktree{Repository: service, CheckoutPath: "/home/dev/wt/service/feature-branch", IsLinkedWorktree: true}},
			},
			Panes: []herdr.PaneInfo{
				{PaneID: "w1:p1", WorkspaceID: "w1", Cwd: "/home/dev"},
				{PaneID: "w2:p1", WorkspaceID: "w2", Cwd: "/home/dev/src/dots"},
				{PaneID: "w2:p2", WorkspaceID: "w2", Cwd: "/home/dev/src/dots/herdr-plugins"},
				{PaneID: "w3:p1", WorkspaceID: "w3", Cwd: "/home/dev/wt/service/feature-branch"},
			},
			Agents: []herdr.AgentInfo{
				{PaneID: "w2:p1", WorkspaceID: "w2", AgentStatus: herdr.AgentWorking, Name: "plugin-dev", Agent: "claude",
					TerminalTitleStripped: "Port the picker to Go"},
				{PaneID: "w3:p1", WorkspaceID: "w3", AgentStatus: herdr.AgentBlocked, Agent: "claude",
					TerminalTitleStripped: "Waiting on approval to force-push"},
			},
		},
		Worktrees: []herdr.WorktreeList{
			{Source: herdr.WorktreeSource{Repository: dots, SourceCheckoutPath: "/home/dev/src/dots"}, Worktrees: []herdr.Worktree{
				{Path: "/home/dev/src/dots", Label: "main", Branch: "main", OpenWorkspaceID: "w2"},
				{Path: "/home/dev/wt/dots/release", Label: "release", Branch: "release", IsLinkedWorktree: true},
				{Path: "/home/dev/wt/dots/stale", Label: "stale", Branch: "stale", IsPrunable: true, IsLinkedWorktree: true},
				{Path: "/home/dev/src/dots-bare", Label: "bare", IsBare: true},
			}},
			{Source: herdr.WorktreeSource{Repository: service, SourceCheckoutPath: "/home/dev/wt/service/feature-branch"}, Worktrees: []herdr.Worktree{
				{Path: "/home/dev/wt/service/feature-branch", Label: "feature-branch", Branch: "feature-branch", IsLinkedWorktree: true, OpenWorkspaceID: "w3"},
			}},
		},
		Dirs: []string{
			"/home/dev/src/dots",
			"/home/dev/notes",
			"/home/dev/wt/dots/release",
			"/home/dev",
			"/opt/tools",
		},
	}
}

func ofKind(k Kind) []Destination {
	var out []Destination
	for _, d := range sources().Destinations(home) {
		if d.Kind == k {
			out = append(out, d)
		}
	}
	return out
}

func field[V any](ds []Destination, f func(Destination) V) []V {
	out := []V{}
	for _, d := range ds {
		out = append(out, f(d))
	}
	return out
}

func eq[V any](t *testing.T, what string, got, want V) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s = %#v, want %#v", what, got, want)
	}
}

func TestEveryWorkspaceBecomesADestination(t *testing.T) {
	eq(t, "ids", field(ofKind(KindWorkspace), func(d Destination) herdr.WorkspaceID { return d.Workspace }),
		[]herdr.WorkspaceID{"w1", "w2", "w3"})
}

func TestAWorkspaceTakesItsBranchFromTheWorktreeListing(t *testing.T) {
	eq(t, "branches", field(ofKind(KindWorkspace), func(d Destination) string { return d.Branch }),
		[]string{"~", "main", "feature-branch"})
}

func TestAWorkspaceWithNoCheckoutFallsBackToItsPanesCwd(t *testing.T) {
	eq(t, "paths", field(ofKind(KindWorkspace), func(d Destination) string { return d.DisplayPath }),
		[]string{"~", "~/src/dots", "~/wt/service/feature-branch"})
}

func TestAnAgentInheritsTheRepoAndBranchOfItsWorkspace(t *testing.T) {
	agents := ofKind(KindAgent)
	eq(t, "repo/branch", field(agents, func(d Destination) [2]string { return [2]string{d.Repo, d.Branch} }),
		[][2]string{{"dots", "main"}, {"service", "feature-branch"}})
	eq(t, "names", field(agents, func(d Destination) string { return d.Name }), []string{"plugin-dev", "claude"})
}

func TestAnAgentOutsideAnyKnownWorkspaceHasNoRepo(t *testing.T) {
	s := Sources{Snapshot: herdr.Snapshot{Agents: []herdr.AgentInfo{{PaneID: "w9:p1", WorkspaceID: "w9"}}}}
	d := s.Destinations(home)[0]
	eq(t, "repo/branch", [2]string{d.Repo, d.Branch}, [2]string{"", "-"})
}

func TestOnlyOpenableWorktreesAreOffered(t *testing.T) {
	// main and feature-branch are open as workspaces; stale is prunable and
	// the bare repo isn't a checkout.
	wts := ofKind(KindWorktree)
	eq(t, "paths", field(wts, func(d Destination) string { return d.Path }), []string{"/home/dev/wt/dots/release"})
	eq(t, "repo root", wts[0].RepoRoot, "/home/dev/src/dots")
}

func TestADirectoryReachableAnotherWayIsDropped(t *testing.T) {
	eq(t, "paths", field(ofKind(KindDirectory), func(d Destination) string { return d.Path }),
		[]string{"/home/dev/notes", "/opt/tools"})
}

func TestTilde(t *testing.T) {
	for _, tt := range []struct{ path, home, want string }{
		{"/home/dev", "/home/dev", "~"},
		{"/home/dev/src", "/home/dev", "~/src"},
		{"/home/dev/src", "/home/dev/", "~/src"},
		{"/opt/tools", "/home/dev", "/opt/tools"},
		{"/home/developer", "/home/dev", "/home/developer"}, // a sibling sharing the prefix
		{"/home/dev/src", "", "/home/dev/src"},
	} {
		if got := tilde(tt.path, tt.home); got != tt.want {
			t.Errorf("tilde(%q, %q) = %q, want %q", tt.path, tt.home, got, tt.want)
		}
	}
}

func TestZoxide(t *testing.T) {
	if _, err := zoxideDirs(context.Background(), "/definitely/not/zoxide"); err == nil ||
		!strings.Contains(err.Error(), "running /definitely/not/zoxide query -l") {
		t.Errorf("missing zoxide: err = %v", err)
	}
	if _, err := zoxideDirs(context.Background(), "false"); err == nil || !strings.Contains(err.Error(), "failed with exit status") {
		t.Errorf("failing zoxide: err = %v", err)
	}
	if _, err := parseZoxide([]byte("/valid\n/bad-\xff\n")); err == nil || !strings.Contains(err.Error(), "not valid UTF-8") {
		t.Errorf("invalid UTF-8: err = %v", err)
	}
	dirs, err := parseZoxide([]byte("/a\n\n/b c\n/d"))
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "dirs", dirs, []string{"/a", "/b c", "/d"})
}

func TestCollectLeavesOutWhatFailsAndSaysSo(t *testing.T) {
	f := &fakeAPI{
		snapshot:  sources().Snapshot,
		worktrees: map[string]herdr.WorktreeList{"/home/dev/src/dots": sources().Worktrees[0]},
	}
	var log bytes.Buffer
	s, err := collect(context.Background(), f, "/definitely/not/zoxide", &log)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "lists", len(s.Worktrees), 1)
	eq(t, "dirs", len(s.Dirs), 0)
	for _, want := range []string{"leaving out the worktrees of /home/dev/src/service", "leaving out zoxide directories"} {
		if !strings.Contains(log.String(), want) {
			t.Errorf("log %q doesn't say %q", log.String(), want)
		}
	}
	eq(t, "calls", f.calls, []string{"session.snapshot", "worktree.list /home/dev/src/dots", "worktree.list /home/dev/src/service"})
}

func TestCollectFailsWithoutASnapshot(t *testing.T) {
	f := &fakeAPI{err: map[string]error{"session.snapshot": errors.New("boom")}}
	if _, err := collect(context.Background(), f, "true", &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "reading the session") {
		t.Errorf("err = %v", err)
	}
}

func build(t *testing.T) *picker.Model[Destination] {
	t.Helper()
	m, err := picker.New(sources().Destinations(home)).Groups(groups()...).Theme(theme.Default()).MatchPaths().Build()
	if err != nil {
		t.Fatal(err) // groups and cells disagree: building is the assertion
	}
	return m
}

func matches(t *testing.T, query string) int {
	t.Helper()
	m := build(t)
	m.Apply(picker.Command{Op: picker.Insert, Text: query})
	return m.Matched()
}

func TestTheDeclaredGroupsAcceptEveryDestination(t *testing.T) {
	eq(t, "default view", matches(t, ""), 6) // workspaces, agents, worktrees
	eq(t, "after /", matches(t, "/"), 2)     // just the directories
}

// The kind and an agent's status are drawn only as a divider and a glyph,
// which aren't searched; HiddenTerms keeps both typeable. Exact atoms, since
// a fuzzy "space" also matches an agent via service…approval…force.
func TestKindAndStatusAreTypeableWithoutBeingColumns(t *testing.T) {
	eq(t, "'workspace", matches(t, "'workspace"), 3)
	eq(t, "'agent", matches(t, "'agent"), 2)
	eq(t, "'worktree", matches(t, "'worktree"), 1)
	eq(t, "'agent 'working", matches(t, "'agent 'working"), 1)
	eq(t, "'agent 'blocked", matches(t, "'agent 'blocked"), 1)
	eq(t, "workspace id", matches(t, "'w3"), 1+1) // w3 and its agent's pane w3:p1
}

// The popup is 100 cells wide at most, and the agent group spends
// agentFixedCells before the task gets anything.
func TestAnAgentTaskIsStillReadableAtThePopupWidth(t *testing.T) {
	m := build(t)
	m.Apply(picker.Command{Op: picker.Insert, Text: "plugin-dev"})
	w := agentFixedCells + 24
	var drawn strings.Builder
	for _, l := range m.Lines(w, 10) {
		drawn.WriteString(l.String())
	}
	if !strings.Contains(drawn.String(), "Port the picker") {
		t.Errorf("task squeezed out at width %d: %q", w, drawn.String())
	}
	if w > 100 {
		t.Errorf("the check needs %d cells, more than the popup's 100", w)
	}
}

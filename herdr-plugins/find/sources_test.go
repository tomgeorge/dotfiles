package main

import (
	"bytes"
	"context"
	"errors"
	"image/color"
	"log/slog"
	"reflect"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"

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
// zoxide directories that overlap all of them. Tests that need one rule
// rather than the whole picture build a smaller Sources inline.
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

func TestAWorkspaceOutsideGitShowsItsLabelAsTheBranch(t *testing.T) {
	eq(t, "branch", ofKind(KindWorkspace)[0].Branch, "~")
}

func TestPathsAreJoinedWhateverTheirTrailingSlash(t *testing.T) {
	s := Sources{
		Snapshot: herdr.Snapshot{Workspaces: []herdr.WorkspaceInfo{{WorkspaceID: "w1",
			Worktree: &herdr.WorkspaceWorktree{Repository: dots, CheckoutPath: "/src/dots/"}}}},
		Worktrees: []herdr.WorktreeList{{Worktrees: []herdr.Worktree{{Path: "/src/dots", Branch: "main", OpenWorkspaceID: "w1"}}}},
		Dirs:      []string{"/src/dots", "/notes/", "/notes"},
	}
	ds := s.Destinations(home)
	eq(t, "branch", ds[0].Branch, "main")
	eq(t, "directories", field(ds[1:], func(d Destination) string { return d.Path }), []string{"/notes/"})
}

// Herdr may not tie a workspace to a checkout its pane sits in; the
// checkout is still one place, not a workspace and a worktree.
func TestAWorktreeAWorkspaceSitsInIsNotOfferedAgain(t *testing.T) {
	s := Sources{
		Snapshot: herdr.Snapshot{
			Workspaces: []herdr.WorkspaceInfo{{WorkspaceID: "w1"}},
			Panes:      []herdr.PaneInfo{{WorkspaceID: "w1", Cwd: "/wt/dots/release/"}},
		},
		Worktrees: []herdr.WorktreeList{{Worktrees: []herdr.Worktree{{Path: "/wt/dots/release", Branch: "release"}}}},
	}
	eq(t, "kinds", field(s.Destinations(home), func(d Destination) Kind { return d.Kind }), []Kind{KindWorkspace})
}

func TestADetachedCheckoutReadsTheSameAsAWorkspaceAndAWorktree(t *testing.T) {
	s := Sources{
		Snapshot: herdr.Snapshot{Workspaces: []herdr.WorkspaceInfo{{WorkspaceID: "w1", Label: "dots",
			Worktree: &herdr.WorkspaceWorktree{Repository: dots, CheckoutPath: "/src/dots"}}}},
		Worktrees: []herdr.WorktreeList{{Worktrees: []herdr.Worktree{
			{Path: "/src/dots", IsDetached: true, OpenWorkspaceID: "w1"},
			{Path: "/wt/dots/bisect", IsDetached: true},
		}}},
	}
	eq(t, "branches", field(s.Destinations(home), func(d Destination) string { return d.Branch }),
		[]string{"(detached)", "(detached)"})
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

// A bare repository or a prunable worktree isn't offered as a worktree, so
// zoxide's entry for it is the only way there.
func TestADirectoryListedButNotOfferedAsAWorktreeStays(t *testing.T) {
	s := sources()
	s.Dirs = []string{"/home/dev/src/dots-bare", "/home/dev/wt/dots/stale"}
	var got []string
	for _, d := range s.Destinations(home) {
		if d.Kind == KindDirectory {
			got = append(got, d.Path)
		}
	}
	eq(t, "paths", got, []string{"/home/dev/src/dots-bare", "/home/dev/wt/dots/stale"})
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
	s, err := collect(context.Background(), f, "/definitely/not/zoxide", slog.New(slog.NewTextHandler(&log, nil)))
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "lists", len(s.Worktrees), 1)
	eq(t, "dirs", len(s.Dirs), 0)
	warnings := strings.Split(strings.TrimSpace(log.String()), "\n")
	eq(t, "warnings", len(warnings), 2)
	for i, want := range []string{`level=WARN msg="leaving out a repository's worktrees" repo=/home/dev/src/service`, `level=WARN msg="leaving out zoxide directories"`} {
		if i < len(warnings) && !strings.Contains(warnings[i], want) {
			t.Errorf("warning %q doesn't say %q", warnings[i], want)
		}
	}
	eq(t, "calls", f.calls, []string{"session.snapshot", "worktree.list /home/dev/src/dots", "worktree.list /home/dev/src/service"})
}

func TestCollectFailsWithoutASnapshot(t *testing.T) {
	f := &fakeAPI{err: map[string]error{"session.snapshot": errors.New("boom")}}
	if _, err := collect(context.Background(), f, "true", discard); err == nil || !strings.Contains(err.Error(), "reading the session") {
		t.Errorf("err = %v", err)
	}
}

// build is the picker as run builds it, so the declared groups and every
// kind's fields are checked against each other.
func build(t *testing.T, s Sources) *picker.Model[entry] {
	t.Helper()
	picker.ScorePaths()
	m, err := picker.New(entries(s.Destinations(home), theme.Default())).Groups(groups()...).Build()
	if err != nil {
		t.Fatal(err) // groups and fields disagree: building is the assertion
	}
	return m
}

func matches(t *testing.T, query string) int {
	t.Helper()
	m := build(t, sources())
	m.Apply(picker.Command{Op: picker.Insert, Text: query})
	return m.Matched()
}

func TestTheDeclaredGroupsAcceptEveryDestination(t *testing.T) {
	eq(t, "default view", matches(t, ""), 6) // workspaces, agents, worktrees
	eq(t, "after /", matches(t, "/"), 2)     // just the directories
}

// Every declared group is a kind open knows how to go to, so a new kind
// can't be offered and then fail only when chosen.
func TestEveryGroupIsAKindOpenHandles(t *testing.T) {
	for _, g := range groups() {
		d := Destination{Kind: Kind(g.Key), Path: t.TempDir()}
		if err := open(context.Background(), &fakeAPI{}, d); err != nil && strings.Contains(err.Error(), "unknown destination kind") {
			t.Errorf("group %q: %v", g.Key, err)
		}
	}
}

// The kind and a status are drawn only as a divider and a glyph, which
// aren't searched; HiddenTerms keeps both typeable. Exact terms, since fuzzy
// ones would also hit rows that merely contain the letters in order.
func TestKindAndStatusAreTypeableWithoutBeingColumns(t *testing.T) {
	eq(t, "'workspace", matches(t, "'workspace"), 3)
	eq(t, "'agent", matches(t, "'agent"), 2)
	eq(t, "'worktree", matches(t, "'worktree"), 1)
	eq(t, "'agent 'working", matches(t, "'agent 'working"), 1)
	eq(t, "'agent 'blocked", matches(t, "'agent 'blocked"), 1)
	eq(t, "'workspace 'blocked", matches(t, "'workspace 'blocked"), 1)
	eq(t, "workspace id", matches(t, "'w3"), 1+1) // w3 and its agent's pane w3:p1
}

// An agent's fixed columns must leave enough of the manifest's popup width
// to show its task.
func TestAnAgentTaskIsStillReadableAtThePopupWidth(t *testing.T) {
	var manifest struct {
		Panes []struct{ Width int } `toml:"panes"`
	}
	if _, err := toml.DecodeFile("herdr-plugin.toml", &manifest); err != nil || len(manifest.Panes) != 1 {
		t.Fatalf("reading the manifest: %v, %d panes", err, len(manifest.Panes))
	}
	w := manifest.Panes[0].Width
	m := build(t, sources())
	m.Apply(picker.Command{Op: picker.Insert, Text: "plugin-dev"})
	var drawn strings.Builder
	for _, l := range m.Lines(w, 10) {
		drawn.WriteString(l.String())
	}
	if !strings.Contains(drawn.String(), "Port the picker to Go") {
		t.Errorf("task squeezed at width %d: %q", w, drawn.String())
	}
}

// With ScorePaths, a hit at the start of a path segment outranks one after
// a space, which fzf's default scheme prefers.
func TestAPathSegmentMatchRanksFirst(t *testing.T) {
	m := build(t, Sources{Dirs: []string{"/x/a b", "/x/a/b"}})
	m.Apply(picker.Command{Op: picker.Insert, Text: "/b"})
	eq(t, "first", m.Matches()[0].Path, "/x/a/b")
}

func TestStatusGlyphsFollowHerdr(t *testing.T) {
	d := theme.Default()
	s := theme.Parse("[ui]\nstatus_indicators = \"symbols\"\n")
	for _, tt := range []struct {
		status      herdr.AgentStatus
		dot, symbol string
		fg          color.Color
	}{
		{herdr.AgentBlocked, "●", "×", d.Red},
		{herdr.AgentWorking, "●", "◐", d.Yellow},
		{herdr.AgentDone, "●", "✓", d.Teal},
		{herdr.AgentIdle, "○", "○", d.Green},
		{herdr.AgentUnknown, "·", "·", d.Muted},
	} {
		eq(t, "dots "+string(tt.status), statusGlyph(tt.status, d), picker.Tag(tt.dot, tt.fg))
		eq(t, "symbols "+string(tt.status), statusGlyph(tt.status, s), picker.Tag(tt.symbol, tt.fg))
	}
}

// Each kind's row, field by field: what's drawn, in which colour, and what's
// searchable (Text) or not (Tag).
func TestEachKindDrawsItsFields(t *testing.T) {
	d := theme.Default()
	first := func(k Kind) picker.Entry { return entries(ofKind(k), d)[0] }
	w2 := entries(ofKind(KindWorkspace), d)[1] // focused, working, on dots/main
	for name, tt := range map[string]struct {
		e    picker.Entry
		want []picker.Field
	}{
		"workspace": {w2, []picker.Field{
			picker.Tag("●", d.Yellow), picker.Text("dots", d.Text), picker.Text("main", d.Blue),
			picker.Text("~/src/dots", d.Muted), picker.Tag("←", d.Accent)}},
		"agent": {first(KindAgent), []picker.Field{
			picker.Tag("●", d.Yellow), picker.Text("plugin-dev", d.Text), picker.Text("dots", d.Muted),
			picker.Text("main", d.Blue), picker.Text("Port the picker to Go", d.Text)}},
		"worktree": {first(KindWorktree), []picker.Field{
			picker.Tag("", d.Muted), picker.Text("dots", d.Text), picker.Text("release", d.Blue),
			picker.Text("~/wt/dots/release", d.Muted), picker.Tag("", d.Accent)}},
		"directory": {first(KindDirectory), []picker.Field{
			picker.Tag("", d.Muted), picker.Text("~/notes", d.Text)}},
	} {
		eq(t, name, tt.e.Fields(), tt.want)
	}
}

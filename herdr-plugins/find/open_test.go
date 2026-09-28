package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tomgeorge/go-herdrkit/herdr"
)

// fakeAPI records calls as "method args" and answers from its fields.
type fakeAPI struct {
	snapshot  herdr.Snapshot
	worktrees map[string]herdr.WorktreeList
	err       map[string]error
	calls     []string
}

func (f *fakeAPI) record(method string, args ...string) error {
	f.calls = append(f.calls, strings.Join(append([]string{method}, args...), " "))
	return f.err[method]
}

func (f *fakeAPI) Snapshot(context.Context) (herdr.Snapshot, error) {
	return f.snapshot, f.record("session.snapshot")
}

func (f *fakeAPI) ListWorktrees(_ context.Context, cwd string) (herdr.WorktreeList, error) {
	if err := f.record("worktree.list", cwd); err != nil {
		return herdr.WorktreeList{}, err
	}
	list, ok := f.worktrees[cwd]
	if !ok {
		return list, errors.New("not a repository")
	}
	return list, nil
}

func (f *fakeAPI) FocusWorkspace(_ context.Context, ws herdr.WorkspaceID) (herdr.WorkspaceInfo, error) {
	return herdr.WorkspaceInfo{WorkspaceID: ws}, f.record("workspace.focus", string(ws))
}

func (f *fakeAPI) FocusAgent(_ context.Context, pane herdr.PaneID) (herdr.AgentInfo, error) {
	return herdr.AgentInfo{PaneID: pane}, f.record("agent.focus", string(pane))
}

func (f *fakeAPI) OpenWorktree(_ context.Context, root, path string, focus bool) (herdr.WorktreeOpened, error) {
	return herdr.WorktreeOpened{}, f.record("worktree.open", root, path, boolArg(focus))
}

func (f *fakeAPI) CreateWorkspace(_ context.Context, cwd, label string, focus bool) (herdr.WorkspaceCreated, error) {
	return herdr.WorkspaceCreated{}, f.record("workspace.create", cwd, label, boolArg(focus))
}

func boolArg(b bool) string {
	if b {
		return "focus"
	}
	return "nofocus"
}

func dispatched(t *testing.T, f *fakeAPI, d Destination) []string {
	t.Helper()
	if err := open(context.Background(), f, d); err != nil {
		t.Fatal(err)
	}
	return f.calls
}

func TestAWorkspaceIsFocusedByItsID(t *testing.T) {
	eq(t, "calls", dispatched(t, &fakeAPI{}, Destination{Kind: KindWorkspace, Workspace: "w2"}),
		[]string{"workspace.focus w2"})
}

func TestAnAgentIsFocusedByItsPane(t *testing.T) {
	eq(t, "calls", dispatched(t, &fakeAPI{}, Destination{Kind: KindAgent, Pane: "w2:p1", Name: "plugin-dev"}),
		[]string{"agent.focus w2:p1"})
}

// repoRoot names the repository and path the checkout; swapped, Herdr
// would open the wrong one.
func TestAWorktreeOpensWithItsRepoRootAndItsPath(t *testing.T) {
	d := Destination{Kind: KindWorktree, RepoRoot: "/src/dots", Path: "/wt/dots/release"}
	eq(t, "calls", dispatched(t, &fakeAPI{}, d), []string{"worktree.open /src/dots /wt/dots/release focus"})
}

// The error is held on screen when the popup fails, so it has to say what
// was being opened as well as what went wrong.
func TestARejectionNamesWhatWasBeingOpened(t *testing.T) {
	plain := tempDir(t)
	checkout := tempDir(t)
	if err := os.Mkdir(filepath.Join(checkout, ".git"), 0o700); err != nil {
		t.Fatal(err)
	}
	withPane := &herdr.Snapshot{Panes: []herdr.PaneInfo{{WorkspaceID: "w7", Cwd: plain}}}
	for _, tt := range []struct {
		d      Destination
		method string
		snap   *herdr.Snapshot
		want   string
	}{
		{Destination{Kind: KindWorkspace, Workspace: "w9"}, "workspace.focus", nil, "focusing w9"},
		{Destination{Kind: KindAgent, Pane: "w2:p1", Name: "dev"}, "agent.focus", nil, "focusing the agent dev in w2:p1"},
		{Destination{Kind: KindWorktree, RepoRoot: "/r", Path: "/r/wt"}, "worktree.open", nil, "opening the worktree at /r/wt"},
		{Destination{Kind: KindDirectory, Path: checkout}, "worktree.open", nil, "opening a workspace for " + checkout},
		{Destination{Kind: KindDirectory, Path: plain}, "session.snapshot", nil, "reading the session"},
		{Destination{Kind: KindDirectory, Path: plain}, "workspace.focus", withPane, "focusing the workspace already in " + plain},
		{Destination{Kind: KindDirectory, Path: plain}, "workspace.create", nil, "creating a workspace for " + plain},
	} {
		f := &fakeAPI{err: map[string]error{tt.method: errors.New("refused")}}
		if tt.snap != nil {
			f.snapshot = *tt.snap
		}
		err := open(context.Background(), f, tt.d)
		if err == nil || !strings.Contains(err.Error(), tt.want) || !strings.Contains(err.Error(), "refused") {
			t.Errorf("%s failing: err = %v, want %q", tt.method, err, tt.want)
		}
	}
}

func TestAnUnknownKindIsAnError(t *testing.T) {
	if err := open(context.Background(), &fakeAPI{}, Destination{Kind: "planet"}); err == nil {
		t.Error("opened a planet")
	}
}

func tempDir(t *testing.T) string {
	t.Helper()
	// Resolved, since macOS's temp dir sits behind a symlink.
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestACheckoutDirectoryOpensAsAWorktree(t *testing.T) {
	for name, mk := range map[string]func(string) error{
		"main checkout":   func(p string) error { return os.Mkdir(p, 0o700) },
		"linked worktree": func(p string) error { return os.WriteFile(p, []byte("gitdir: /x\n"), 0o600) },
		"symlinked .git": func(p string) error {
			real := filepath.Join(filepath.Dir(p), "real.git")
			if err := os.Mkdir(real, 0o700); err != nil {
				return err
			}
			return os.Symlink(real, p)
		},
	} {
		dir := tempDir(t)
		if err := mk(filepath.Join(dir, ".git")); err != nil {
			t.Fatal(err)
		}
		eq(t, name, dispatched(t, &fakeAPI{}, Destination{Kind: KindDirectory, Path: dir}),
			[]string{"worktree.open " + dir + " " + dir + " focus"})
	}
}

func TestADirectoryAPaneSitsInFocusesThatWorkspace(t *testing.T) {
	dir := tempDir(t)
	f := &fakeAPI{snapshot: herdr.Snapshot{Panes: []herdr.PaneInfo{
		{PaneID: "w1:p1", WorkspaceID: "w1", Cwd: "/elsewhere"},
		{PaneID: "w7:p2", WorkspaceID: "w7", Cwd: dir},
	}}}
	eq(t, "calls", dispatched(t, f, Destination{Kind: KindDirectory, Path: dir}),
		[]string{"session.snapshot", "workspace.focus w7"})
}

// A pane in a subdirectory isn't in the directory.
func TestAPaneBelowTheDirectoryDoesNotCount(t *testing.T) {
	dir := tempDir(t)
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	f := &fakeAPI{snapshot: herdr.Snapshot{Panes: []herdr.PaneInfo{{WorkspaceID: "w7", Cwd: filepath.Join(dir, "sub")}}}}
	eq(t, "calls", dispatched(t, f, Destination{Kind: KindDirectory, Path: dir}),
		[]string{"session.snapshot", "workspace.create " + dir + " " + filepath.Base(dir) + " focus"})
}

// A dangling .git link isn't a checkout; the directory opens as a plain one.
func TestADanglingGitLinkIsNotACheckout(t *testing.T) {
	dir := tempDir(t)
	if err := os.Symlink(filepath.Join(dir, "gone"), filepath.Join(dir, ".git")); err != nil {
		t.Fatal(err)
	}
	eq(t, "calls", dispatched(t, &fakeAPI{}, Destination{Kind: KindDirectory, Path: dir}),
		[]string{"session.snapshot", "workspace.create " + dir + " " + filepath.Base(dir) + " focus"})
}

// The pane got there through a symlink; it's still the same directory.
func TestAPaneInTheDirectoryThroughASymlinkCounts(t *testing.T) {
	dir := tempDir(t)
	link := filepath.Join(tempDir(t), "link")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	f := &fakeAPI{snapshot: herdr.Snapshot{Panes: []herdr.PaneInfo{
		{PaneID: "w1:p1", WorkspaceID: "w1", Cwd: "/definitely/not/here"},
		{PaneID: "w7:p2", WorkspaceID: "w7", Cwd: link + "/"},
	}}}
	eq(t, "calls", dispatched(t, f, Destination{Kind: KindDirectory, Path: dir}),
		[]string{"session.snapshot", "workspace.focus w7"})
}

func TestANewDirectoryGetsANewWorkspace(t *testing.T) {
	dir := filepath.Join(tempDir(t), "notes")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(tempDir(t), "link")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	// Through a symlink, so the workspace opens on the real directory.
	eq(t, "calls", dispatched(t, &fakeAPI{}, Destination{Kind: KindDirectory, Path: link}),
		[]string{"session.snapshot", "workspace.create " + dir + " notes focus"})
}

func TestAMissingDirectoryIsAnError(t *testing.T) {
	err := open(context.Background(), &fakeAPI{}, Destination{Kind: KindDirectory, Path: "/definitely/not/here"})
	if err == nil || !strings.Contains(err.Error(), "resolving /definitely/not/here") {
		t.Errorf("err = %v", err)
	}
}

// zoxide can remember a directory that has since been replaced by a file.
func TestAFileIsNotADirectory(t *testing.T) {
	file := filepath.Join(tempDir(t), "notes")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	f := &fakeAPI{}
	err := open(context.Background(), f, Destination{Kind: KindDirectory, Path: file})
	if err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Errorf("err = %v", err)
	}
	eq(t, "calls", f.calls, []string(nil))
}

func TestRunRequiresThePickerEntrypoint(t *testing.T) {
	t.Setenv("HERDR_PLUGIN_ENTRYPOINT_ID", "")
	if err := run(discard); err == nil || !strings.Contains(err.Error(), "picker pane entrypoint") {
		t.Errorf("err = %v", err)
	}
}

// choose is a chooser that records what it was shown and picks by index;
// -1 backs out.
func choose(shown *[]Destination, i int, err error) chooser {
	return func(ds []Destination) (Destination, bool, error) {
		*shown = ds
		if err != nil || i < 0 {
			return Destination{}, false, err
		}
		return ds[i], true, nil
	}
}

var discard = slog.New(slog.DiscardHandler)

func fakeSession() *fakeAPI {
	return &fakeAPI{snapshot: herdr.Snapshot{Workspaces: []herdr.WorkspaceInfo{{WorkspaceID: "w1"}, {WorkspaceID: "w2"}}}}
}

func TestFindOpensWhatWasChosen(t *testing.T) {
	f := fakeSession()
	var shown []Destination
	if err := find(f, "true", home, choose(&shown, 1, nil), discard); err != nil {
		t.Fatal(err)
	}
	eq(t, "shown", len(shown), 2)
	eq(t, "calls", f.calls, []string{"session.snapshot", "workspace.focus w2"})
}

func TestBackingOutOpensNothingAndIsNotAnError(t *testing.T) {
	f := fakeSession()
	var shown []Destination
	if err := find(f, "true", home, choose(&shown, -1, nil), discard); err != nil {
		t.Fatal(err)
	}
	eq(t, "calls", f.calls, []string{"session.snapshot"})
}

func TestAPickerFailureIsReturned(t *testing.T) {
	var shown []Destination
	boom := errors.New("no terminal")
	if err := find(fakeSession(), "true", home, choose(&shown, 0, boom), discard); !errors.Is(err, boom) {
		t.Errorf("err = %v", err)
	}
}

func TestNothingToJumpToIsAnError(t *testing.T) {
	var shown []Destination
	err := find(&fakeAPI{}, "true", home, choose(&shown, 0, nil), discard)
	if err == nil || !strings.Contains(err.Error(), "nothing to jump to") {
		t.Errorf("err = %v", err)
	}
	if shown != nil {
		t.Error("the picker was shown an empty list")
	}
}

func TestLogsAppendToTheStateDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	for _, msg := range []string{"first", "second"} {
		log, path, err := openLog(dir)
		if err != nil {
			t.Fatal(err)
		}
		eq(t, "path", path, filepath.Join(dir, "errors.log"))
		log.Error(msg)
	}
	got, err := os.ReadFile(filepath.Join(dir, "errors.log"))
	if err != nil {
		t.Fatal(err)
	}
	if lines := strings.Split(strings.TrimSpace(string(got)), "\n"); len(lines) != 2 ||
		!strings.Contains(lines[0], "level=ERROR msg=first") || !strings.Contains(lines[1], "msg=second") {
		t.Errorf("log = %q, want both runs' errors, one line each", got)
	}

	if _, path, err := openLog(""); path != "" || err != nil {
		t.Errorf("no state dir: %q, %v; want nothing logged", path, err)
	}
}

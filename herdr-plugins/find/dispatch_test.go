package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// cwd names the repository and path the checkout; Herdr resolves the list
// from cwd, so they aren't interchangeable.
func TestAWorktreeOpensWithItsRepoRootAndItsPath(t *testing.T) {
	d := Destination{Kind: KindWorktree, RepoRoot: "/src/dots", Path: "/wt/dots/release"}
	eq(t, "calls", dispatched(t, &fakeAPI{}, d), []string{"worktree.open /src/dots /wt/dots/release focus"})
}

func TestARejectionNamesWhatWasBeingOpened(t *testing.T) {
	f := &fakeAPI{err: map[string]error{"workspace.focus": errors.New("no such workspace")}}
	err := open(context.Background(), f, Destination{Kind: KindWorkspace, Workspace: "w9"})
	if err == nil || !strings.Contains(err.Error(), "focusing w9") || !strings.Contains(err.Error(), "no such workspace") {
		t.Errorf("err = %v", err)
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

func TestRunRequiresThePickerEntrypoint(t *testing.T) {
	t.Setenv("HERDR_PLUGIN_ENTRYPOINT_ID", "")
	if err := run(&strings.Builder{}); err == nil || !strings.Contains(err.Error(), "picker pane entrypoint") {
		t.Errorf("err = %v", err)
	}
}

func TestErrorsAreAppendedToTheStateDirLog(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	now := time.Date(2026, 9, 26, 17, 0, 0, 0, time.UTC)
	for _, msg := range []string{"first", "second"} {
		path, err := logError(dir, errors.New(msg), now)
		if err != nil {
			t.Fatal(err)
		}
		eq(t, "path", path, filepath.Join(dir, "errors.log"))
	}
	got, err := os.ReadFile(filepath.Join(dir, "errors.log"))
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "log", string(got), "2026-09-26T17:00:00Z first\n2026-09-26T17:00:00Z second\n")

	if path, err := logError("", errors.New("x"), now); path != "" || err != nil {
		t.Errorf("no state dir: %q, %v; want nothing logged", path, err)
	}
}

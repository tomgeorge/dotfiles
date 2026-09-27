package herdr

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"testing"
	"time"
)

// Live tests talk to a real Herdr server. They only ping, which changes no
// state. Opt in with HERDR_LIVE=1; they use HERDR_SOCKET_PATH.
func liveClient(t *testing.T) *Client {
	t.Helper()
	if os.Getenv("HERDR_LIVE") != "1" {
		t.Skip("set HERDR_LIVE=1 to run against a real server")
	}
	c, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestLivePing(t *testing.T) {
	c := liveClient(t)
	p, err := c.Ping(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("herdr %s, protocol %d, capabilities %+v", p.Version, p.Protocol, p.Capabilities)
	if p.Protocol != Protocol {
		t.Logf("WARNING: server protocol %d, package written for %d", p.Protocol, Protocol)
	}
}

// Verifies herdrkit's claim that the server answers one request per
// connection and closes it: send two pings on one connection, expect exactly
// one reply followed by EOF (or silence).
func TestLiveOneRequestPerConnection(t *testing.T) {
	c := liveClient(t)
	conn, err := net.Dial("unix", c.SocketPath())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	if err := conn.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"live-1", "live-2"} {
		line, _ := json.Marshal(request{ID: id, Method: "ping", Params: struct{}{}})
		// The second write may fail if the server already closed; that's the
		// behaviour we're checking for, not a test error.
		_, _ = conn.Write(append(line, '\n'))
	}

	r := bufio.NewReader(conn)
	first, err := readFrame(r, MaxFrameBytes)
	if err != nil {
		t.Fatalf("first reply: %v", err)
	}
	var env envelope
	if err := json.Unmarshal(first, &env); err != nil || env.ID == nil || *env.ID != "live-1" {
		t.Fatalf("first reply = %s (err %v), want id live-1", first, err)
	}

	second, err := readFrame(r, MaxFrameBytes)
	if err == nil {
		t.Fatalf("server answered a second request on the same connection: %s", second)
	}
	t.Logf("no second reply, as expected: %v", err)
}

// Read-only: reports what runs in the test's own pane.
func TestLiveProcessInfo(t *testing.T) {
	c := liveClient(t)
	info, err := c.ProcessInfo(context.Background(), PaneID(os.Getenv("HERDR_PANE_ID")))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", info)
}

// Read-only: lists the tabs of the focused workspace.
func TestLiveListTabs(t *testing.T) {
	c := liveClient(t)
	tabs, err := c.ListTabs(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", tabs)
}

// Read-only: lists workspaces.
func TestLiveListWorkspaces(t *testing.T) {
	c := liveClient(t)
	wss, err := c.ListWorkspaces(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v", wss)
}

// Read-only: decodes the whole session, which checks every required field
// against a real server. Logs counts, not content.
func TestLiveSnapshot(t *testing.T) {
	c := liveClient(t)
	s, err := c.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("herdr %s: %d workspaces, %d tabs, %d panes, %d agents, repos %d",
		s.Version, len(s.Workspaces), len(s.Tabs), len(s.Panes), len(s.Agents), len(s.RepositoryRoots()))
}

// Read-only: lists the worktrees of every repository with an open workspace.
func TestLiveListWorktrees(t *testing.T) {
	c := liveClient(t)
	s, err := c.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, root := range s.RepositoryRoots() {
		list, err := c.ListWorktrees(context.Background(), root)
		if err != nil {
			t.Errorf("%s: %v", root, err)
			continue
		}
		t.Logf("%s: %d worktrees", list.Source.Repository.Name, len(list.Worktrees))
	}
}

// Focuses the workspace that already has focus, which changes nothing, to
// check the reply shape against a real server: a fake built from the same
// assumption can't catch a wrong result tag.
func TestLiveFocusFocusedWorkspace(t *testing.T) {
	c := liveClient(t)
	s, err := c.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.FocusedWorkspaceID == "" {
		t.Skip("no focused workspace")
	}
	ws, err := c.FocusWorkspace(context.Background(), s.FocusedWorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if ws.WorkspaceID != s.FocusedWorkspaceID || !ws.Focused {
		t.Errorf("focused %+v, want %s", ws, s.FocusedWorkspaceID)
	}
}

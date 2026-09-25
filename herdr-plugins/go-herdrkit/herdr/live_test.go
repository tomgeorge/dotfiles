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

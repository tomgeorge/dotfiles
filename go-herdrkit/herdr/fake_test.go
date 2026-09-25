package herdr

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
)

// sent is a request as the fake server received it.
type sent struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	raw    []byte
}

// fakeServer accepts exactly one connection, hands the decoded request to
// respond, writes whatever bytes respond returns (nil = say nothing and hold the
// connection open until the client leaves), and closes the connection.
func fakeServer(t *testing.T, respond func(req sent) []byte) (*Client, <-chan sent) {
	t.Helper()
	// macOS caps unix socket paths at 104 bytes; t.TempDir() can exceed that.
	dir, err := os.MkdirTemp("", "hk")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "s")

	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan sent, 1)
	done := make(chan struct{})
	t.Cleanup(func() { _ = ln.Close(); <-done })

	go func() {
		defer close(done)
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		line, err := bufio.NewReader(conn).ReadBytes('\n')
		if err != nil {
			t.Errorf("fake: read request: %v", err)
			return
		}
		var req sent
		if err := json.Unmarshal(line, &req); err != nil {
			t.Errorf("fake: decode request %q: %v", line, err)
			return
		}
		req.raw = line
		got <- req
		out := respond(req)
		if out == nil {
			_, _ = conn.Read(make([]byte, 1)) // until the client hangs up
			return
		}
		_, _ = conn.Write(out)
	}()
	return New(path), got
}

// answer builds a success frame echoing the request id.
func answer(result string) func(sent) []byte {
	return func(req sent) []byte {
		return []byte(`{"id":` + quote(req.ID) + `,"result":` + result + "}\n")
	}
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

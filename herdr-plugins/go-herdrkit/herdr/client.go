// Package herdr is a client for Herdr's Unix-socket API.
//
// Transport semantics (one connection per request, frame cap, deadline slack)
// follow herdrkit, MIT, github.com/joshrwolf/dots.
package herdr

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

// Protocol is the Herdr socket protocol this package was written against.
const Protocol = 22

// DefaultTimeout bounds an ordinary call, so a hung server can't leave a
// plugin (often a popup) blank indefinitely.
const DefaultTimeout = 3 * time.Second

// MaxFrameBytes caps a reply frame, excluding the newline. Replies are local
// control-plane data; the cap stops a faulty peer growing memory unbounded
// while leaving room for large snapshots and pane reads.
const MaxFrameBytes = 8 << 20

var nextID atomic.Uint64

// Client talks to one Herdr server. It holds no connection: the server answers
// one request per connection and closes it, so every call dials afresh.
type Client struct {
	socketPath string
}

// New returns a client for the server listening at socketPath.
func New(socketPath string) *Client {
	return &Client{socketPath: socketPath}
}

// FromEnv returns a client for the server that invoked this plugin.
func FromEnv() (*Client, error) {
	path := os.Getenv("HERDR_SOCKET_PATH")
	if path == "" {
		return nil, ErrNoSocket
	}
	return New(path), nil
}

// SocketPath is the endpoint this client dials.
func (c *Client) SocketPath() string { return c.socketPath }

// reply is a wire struct that converts itself into the public result type,
// failing if a required field is absent. Wire structs use pointers for
// required fields precisely so absence is observable.
type reply[R any] interface {
	result(method string) (R, error)
}

type request struct {
	ID     string `json:"id"`
	Method string `json:"method"`
	Params any    `json:"params"`
}

type envelope struct {
	ID     *string         `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// call pairs a method with its result tag, wire type W and public type R in
// one place, so the three can't drift apart across call sites.
func call[W reply[R], R any](ctx context.Context, c *Client, method, tag string, params any, timeout time.Duration) (R, error) {
	var zero R
	raw, err := c.exchange(ctx, method, params, timeout)
	if err != nil {
		return zero, err
	}
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return zero, fmt.Errorf("%s: %w: result: %v", method, ErrProtocol, err)
	}
	if head.Type != tag {
		return zero, fmt.Errorf("%s: %w: want %q, got %q", method, ErrWrongResult, tag, head.Type)
	}
	var w W
	if err := json.Unmarshal(raw, &w); err != nil {
		return zero, fmt.Errorf("%s: %w: decode %s: %v", method, ErrProtocol, tag, err)
	}
	return w.result(method)
}

// exchange does one request on one connection and returns the raw result.
func (c *Client) exchange(ctx context.Context, method string, params any, timeout time.Duration) (json.RawMessage, error) {
	id := strconv.Itoa(os.Getpid()) + "-" + strconv.FormatUint(nextID.Add(1), 10)

	line, err := json.Marshal(request{ID: id, Method: method, Params: params})
	if err != nil {
		return nil, fmt.Errorf("%s: encode request: %w", method, err)
	}
	line = append(line, '\n')

	deadline := time.Now().Add(timeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}

	var dialer net.Dialer
	dialCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	conn, err := dialer.DialContext(dialCtx, "unix", c.socketPath)
	if err != nil {
		return nil, fmt.Errorf("%s: connect %s: %w", method, c.socketPath, err)
	}
	// The reply is fully read (or abandoned) by now; a close error changes nothing.
	defer func() { _ = conn.Close() }()

	if err := conn.SetDeadline(deadline); err != nil {
		return nil, fmt.Errorf("%s: set deadline: %w", method, err)
	}
	// Deadlines don't observe cancellation; closing the conn unblocks I/O.
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()

	frame, err := func() ([]byte, error) {
		if _, err := conn.Write(line); err != nil {
			return nil, fmt.Errorf("write: %w", err)
		}
		return readFrame(bufio.NewReader(conn), MaxFrameBytes)
	}()
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("%s: %w", method, ctx.Err())
		}
		return nil, fmt.Errorf("%s: %w", method, err)
	}

	var env envelope
	if err := json.Unmarshal(frame, &env); err != nil {
		return nil, fmt.Errorf("%s: %w: %v", method, ErrProtocol, err)
	}
	if env.ID == nil || *env.ID != id {
		got := "<none>"
		if env.ID != nil {
			got = strconv.Quote(*env.ID)
		}
		return nil, fmt.Errorf("%s: %w: sent %q, got %s", method, ErrIDMismatch, id, got)
	}
	if env.Error != nil {
		return nil, &APIError{Method: method, Code: env.Error.Code, Message: env.Error.Message}
	}
	if len(env.Result) == 0 || bytes.Equal(env.Result, []byte("null")) {
		return nil, fmt.Errorf("%s: %w: reply has neither result nor error", method, ErrProtocol)
	}
	return env.Result, nil
}

// readFrame reads one newline-terminated frame of at most limit bytes. A frame
// cut off by EOF is a protocol error: the server always terminates replies.
func readFrame(r *bufio.Reader, limit int) ([]byte, error) {
	var buf []byte
	for {
		chunk, err := r.ReadSlice('\n')
		if len(buf)+len(chunk) > limit+1 { // +1 for the newline
			return nil, fmt.Errorf("%w: over %d bytes", ErrFrameTooLarge, limit)
		}
		buf = append(buf, chunk...)
		switch {
		case err == nil:
			return buf[:len(buf)-1], nil
		case errors.Is(err, bufio.ErrBufferFull):
			continue
		case errors.Is(err, io.EOF):
			if len(buf) == 0 {
				return nil, fmt.Errorf("%w: connection closed without a reply", ErrProtocol)
			}
			return nil, fmt.Errorf("%w: truncated frame (%d bytes, no newline)", ErrProtocol, len(buf))
		default:
			return nil, fmt.Errorf("read: %w", err)
		}
	}
}

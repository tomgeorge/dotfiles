package herdr

import "context"

// Pong is the server's answer to Ping.
type Pong struct {
	Version  string
	Protocol uint32
	// Capabilities is nil when the server doesn't report them.
	Capabilities *ServerCapabilities
}

// ServerCapabilities describes optional server features.
type ServerCapabilities struct {
	LiveHandoff        bool
	DetachedDaemon     bool
	HealthCheck        bool
	SurfaceInterest    bool
	EndpointGeneration *uint32
}

// Ping checks the server is alive and reports its version and protocol.
// Compare Pong.Protocol with Protocol to detect a server this package may not
// fully understand; a mismatch isn't an error here.
func (c *Client) Ping(ctx context.Context) (Pong, error) {
	return call[pongWire, Pong](ctx, c, "ping", "pong", struct{}{}, DefaultTimeout)
}

type pongWire struct {
	Version      *string           `json:"version"`
	Protocol     *uint32           `json:"protocol"`
	Capabilities *capabilitiesWire `json:"capabilities"`
}

type capabilitiesWire struct {
	LiveHandoff        *bool   `json:"live_handoff"`
	DetachedDaemon     bool    `json:"detached_server_daemon"`
	HealthCheck        bool    `json:"health_check"`
	SurfaceInterest    bool    `json:"surface_interest"`
	EndpointGeneration *uint32 `json:"endpoint_protocol_generation"`
}

func (w pongWire) result(method string) (Pong, error) {
	if w.Version == nil {
		return Pong{}, missing(method, "version")
	}
	if w.Protocol == nil {
		return Pong{}, missing(method, "protocol")
	}
	p := Pong{Version: *w.Version, Protocol: *w.Protocol}
	if w.Capabilities != nil {
		if w.Capabilities.LiveHandoff == nil {
			return Pong{}, missing(method, "capabilities.live_handoff")
		}
		p.Capabilities = &ServerCapabilities{
			LiveHandoff:        *w.Capabilities.LiveHandoff,
			DetachedDaemon:     w.Capabilities.DetachedDaemon,
			HealthCheck:        w.Capabilities.HealthCheck,
			SurfaceInterest:    w.Capabilities.SurfaceInterest,
			EndpointGeneration: w.Capabilities.EndpointGeneration,
		}
	}
	return p, nil
}

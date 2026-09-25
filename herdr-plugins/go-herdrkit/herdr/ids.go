package herdr

// IDs are opaque strings such as "w1", "w1:t2" or "w1:p3". Distinct types
// stop a tab id being passed where a pane id belongs.
type (
	PaneID      string
	TabID       string
	WorkspaceID string
)

// Direction is a direction to move focus in.
type Direction string

const (
	Left  Direction = "left"
	Right Direction = "right"
	Up    Direction = "up"
	Down  Direction = "down"
)

// okWire is the reply of methods that return only {"type":"ok"}.
type okWire struct{}

func (okWire) result(string) (struct{}, error) { return struct{}{}, nil }

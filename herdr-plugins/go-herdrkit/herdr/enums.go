package herdr

// Enums the server sends decode unknown values to an Unknown constant, so a
// Herdr release that adds a value can't break a switch that forgot a default.

// FocusReason says why FocusDirection didn't move focus.
type FocusReason string

const (
	FocusNoNeighbor    FocusReason = "no_neighbor"
	FocusReasonUnknown FocusReason = "unknown"
)

func (r *FocusReason) UnmarshalText(b []byte) error {
	switch v := FocusReason(b); v {
	case FocusNoNeighbor:
		*r = v
	default:
		*r = FocusReasonUnknown
	}
	return nil
}

// AgentStatus is the state of the agent in a pane, or the most urgent one
// across a tab's panes.
type AgentStatus string

const (
	AgentIdle    AgentStatus = "idle"
	AgentWorking AgentStatus = "working"
	AgentBlocked AgentStatus = "blocked"
	AgentDone    AgentStatus = "done"
	AgentUnknown AgentStatus = "unknown"
)

func (s *AgentStatus) UnmarshalText(b []byte) error {
	switch v := AgentStatus(b); v {
	case AgentIdle, AgentWorking, AgentBlocked, AgentDone:
		*s = v
	default:
		*s = AgentUnknown
	}
	return nil
}

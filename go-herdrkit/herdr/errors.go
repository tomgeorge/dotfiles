package herdr

import (
	"errors"
	"fmt"
)

var (
	// ErrNoSocket means HERDR_SOCKET_PATH is unset or empty.
	ErrNoSocket = errors.New("herdr: HERDR_SOCKET_PATH is not set")
	// ErrProtocol means the server sent something that is not a valid reply
	// envelope: bad JSON, a truncated frame, or neither result nor error.
	ErrProtocol = errors.New("herdr: protocol error")
	// ErrIDMismatch means the reply answered a different request.
	ErrIDMismatch = errors.New("herdr: reply id does not match request id")
	// ErrWrongResult means result.type was not the tag the method promises.
	ErrWrongResult = errors.New("herdr: unexpected result type")
	// ErrFrameTooLarge means a reply exceeded MaxFrameBytes.
	ErrFrameTooLarge = errors.New("herdr: reply frame too large")
	// ErrMissingField means a field the schema marks required was absent or
	// null. Go would otherwise zero-fill it silently.
	ErrMissingField = errors.New("herdr: required field missing")
)

// APIError is an error_response from the server.
type APIError struct {
	Method  string
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("herdr: %s: %s: %s", e.Method, e.Code, e.Message)
}

func missing(method, field string) error {
	return fmt.Errorf("%s: %w: %s", method, ErrMissingField, field)
}

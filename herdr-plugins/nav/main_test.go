package main

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestRunArgs(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "")
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "")
	for name, args := range map[string][]string{
		"none":          nil,
		"not pane":      {"tab", "next"},
		"bad direction": {"pane", "sideways"},
		"extra":         {"pane", "left", "x"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := run(args, io.Discard); err == nil {
				t.Error("want usage error")
			}
		})
	}
}

// Outside herdr, nvim's edge goes straight to the outer terminal.
func TestRunOutsideHerdr(t *testing.T) {
	log := filepath.Join(t.TempDir(), "outer.log")
	t.Setenv("HERDR_SOCKET_PATH", "")
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "")
	t.Setenv("HERDR_NAV_OUTER_LOG", log)
	if err := run([]string{"pane", "right"}, io.Discard); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "pane right\n" {
		t.Errorf("outer log = %q", b)
	}
}

func TestRunUnknownAction(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "/nonexistent")
	t.Setenv("HERDR_PLUGIN_ACTION_ID", "sideways")
	if err := run(nil, io.Discard); err == nil {
		t.Error("want error")
	}
}

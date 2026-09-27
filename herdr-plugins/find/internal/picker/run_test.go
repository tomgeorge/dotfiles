package picker

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

func testPicker() *Picker[thing] {
	items := []thing{fruit("apple", "red"), fruit("apricot", "orange"), fruit("banana", "yellow")}
	return New(items).Groups(fruitGroup()).Theme(theme.Default()).Prompt("> ")
}

// run drives a real Bubble Tea program with scripted terminal input.
func run(t *testing.T, input string) (thing, bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, ok, err := testPicker().Run(
		tea.WithInput(strings.NewReader(input)),
		tea.WithOutput(io.Discard),
		tea.WithWindowSize(60, 10),
		tea.WithContext(ctx),
	)
	if err != nil {
		t.Fatal(err)
	}
	return got, ok
}

func TestRunReturnsTheChosenEntry(t *testing.T) {
	got, ok := run(t, "ban\r")
	if !ok || got.name != "banana" {
		t.Errorf("chose %+v (ok %v), want banana", got, ok)
	}
}

func TestRunMovesWithControlKeys(t *testing.T) {
	got, ok := run(t, "\x0e\x0e\x10\r") // ctrl-n ctrl-n ctrl-p enter
	if !ok || got.name != "apricot" {
		t.Errorf("chose %+v (ok %v), want apricot", got, ok)
	}
}

func TestRunAbortIsNotAnError(t *testing.T) {
	if got, ok := run(t, "ap\x07"); ok { // ctrl-g
		t.Errorf("abort chose %+v", got)
	}
}

func TestRunAcceptingNothingChoosesNothing(t *testing.T) {
	if got, ok := run(t, "zzz\r"); ok {
		t.Errorf("chose %+v from an empty list", got)
	}
}

func TestViewFillsTheWindowExactly(t *testing.T) {
	m, err := testPicker().Build()
	if err != nil {
		t.Fatal(err)
	}
	p := &program[thing]{model: m, prompt: "> "}
	p.Update(tea.WindowSizeMsg{Width: 30, Height: 6})
	p.Update(tea.KeyPressMsg{Code: 'a', Text: "a"})
	v := p.View()
	lines := strings.Split(v.Content, "\n")
	if len(lines) != 6 {
		t.Fatalf("%d lines, want 6:\n%s", len(lines), v.Content)
	}
	for i, l := range lines {
		if w := ansi.StringWidth(l); w != 30 {
			t.Errorf("line %d is %d cells: %q", i, w, ansi.Strip(l))
		}
	}
	if got := ansi.Strip(lines[0]); !strings.HasPrefix(got, "> a") || !strings.HasSuffix(got, "3/3") {
		t.Errorf("prompt line = %q", got)
	}
	if !v.AltScreen || v.Cursor == nil || v.Cursor.X != 3 || v.Cursor.Y != 0 {
		t.Errorf("view = alt %v cursor %+v, want the alt screen and the caret after the query", v.AltScreen, v.Cursor)
	}
}

func TestPromptLineNeverExceedsTheWidth(t *testing.T) {
	m, err := testPicker().Build()
	if err != nil {
		t.Fatal(err)
	}
	m.Apply(Command{Op: Insert, Text: "a long query"})
	for w := 0; w < 20; w++ {
		p := &program[thing]{model: m, prompt: "> ", width: w, height: 5}
		line, caret := p.promptLine()
		if got := lineWidth(line); got != w {
			t.Errorf("prompt at width %d drew %d cells", w, got)
		}
		if caret > max(w-1, 0) {
			t.Errorf("caret at %d past width %d", caret, w)
		}
	}
}

func TestPasteIsInserted(t *testing.T) {
	m, err := testPicker().Build()
	if err != nil {
		t.Fatal(err)
	}
	p := &program[thing]{model: m, prompt: "> "}
	p.Update(tea.PasteMsg{Content: "ban\nana"})
	eq(t, "query", m.Query(), "ban ana")
}

func TestRenderPaintsTheBackground(t *testing.T) {
	var b bytes.Buffer
	b.WriteString(render(Line{Spans: []Span{{"x", white}}, Bg: theme.Default().Background}))
	if !strings.Contains(b.String(), "48;2;24;24;37") {
		t.Errorf("render = %q, want Catppuccin's panel background", b.String())
	}
}

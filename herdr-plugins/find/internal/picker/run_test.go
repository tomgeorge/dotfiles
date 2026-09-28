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
)

func testPicker() *Picker[thing] {
	items := []thing{fruit("apple", "red"), fruit("apricot", "orange"), fruit("banana", "yellow")}
	return New(items).Groups(fruitGroup()).Palette(testPalette).Prompt("> ")
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
	p := &program[thing]{model: m}
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
		line, caret := m.PromptLine(w)
		if got := lineWidth(line); got != w {
			t.Errorf("prompt at width %d drew %d cells", w, got)
		}
		if caret > max(w-1, 0) {
			t.Errorf("caret at %d past width %d", caret, w)
		}
	}
}

// The caret must sit on the character an edit would change, however far
// the query has scrolled.
func TestALongQueryScrollsToKeepTheCaretInView(t *testing.T) {
	m, err := testPicker().Build()
	if err != nil {
		t.Fatal(err)
	}
	m.Apply(Command{Op: Insert, Text: "abcdefghijklmnop"})
	under := func() string {
		line, caret := m.PromptLine(10)
		cs := clusters(line.String())
		if caret >= len(cs) {
			return ""
		}
		return cs[caret]
	}
	eq(t, "at the end", under(), " ")
	m.Apply(Command{Op: CaretLeft})
	eq(t, "one left", under(), "p")
	m.Apply(Command{Op: CaretHome})
	eq(t, "home", under(), "a")
	for range 8 {
		m.Apply(Command{Op: CaretRight})
	}
	eq(t, "middle", under(), "i")
}

func TestTheCountGivesWayBeforeTheQueryIsCut(t *testing.T) {
	m, err := testPicker().Build()
	if err != nil {
		t.Fatal(err)
	}
	m.Apply(Command{Op: Insert, Text: "a"})
	if line, _ := m.PromptLine(12); !strings.HasSuffix(line.String(), "3/3") {
		t.Errorf("short query: %q, want the count", line.String())
	}
	m.Apply(Command{Op: Insert, Text: "pple x"})
	if line, _ := m.PromptLine(12); line.String() != "> apple x   " {
		t.Errorf("long query: %q, want the whole query and no count", line.String())
	}
}

func TestPasteIsInserted(t *testing.T) {
	m, err := testPicker().Build()
	if err != nil {
		t.Fatal(err)
	}
	p := &program[thing]{model: m}
	p.Update(tea.PasteMsg{Content: "ban\nana"})
	eq(t, "query", m.Query(), "ban ana")
}

func TestRenderPaintsTheBackground(t *testing.T) {
	var b bytes.Buffer
	b.WriteString(render(Line{Spans: []Span{{"x", white}}, Bg: testPalette.Background}))
	if !strings.Contains(b.String(), "48;2;24;24;37") {
		t.Errorf("render = %q, want the palette's background", b.String())
	}
}

func TestFitQuery(t *testing.T) {
	for _, tt := range []struct {
		query       string
		caret, room int
		want        string
		wantCaret   int
	}{
		{"abc", 3, 4, "abc", 3},                // fits with the caret after it
		{"abcdef", 6, 4, "…ef ", 3},            // at the end: only the left is cut
		{"abcdef", 0, 4, "abc…", 0},            // at home: only the right is cut
		{"abcdef", 3, 5, "abcd…", 3},           // left first, so the start shows
		{"abcdefgh", 4, 5, "…cde…", 3},         // in the middle: both sides cut
		{"日本", 0, 3, "日…", 0},                  // a wide character still shows
		{"cafe\u0301s", 3, 4, "…fe\u0301…", 2}, // a cluster moves as one
		{"abcdef", 6, 1, "", 0},                // no room for anything but the caret
	} {
		got, caret := fitQuery(tt.query, tt.caret, tt.room)
		if got != tt.want || caret != tt.wantCaret {
			t.Errorf("fitQuery(%q, %d, %d) = %q, %d; want %q, %d", tt.query, tt.caret, tt.room, got, caret, tt.want, tt.wantCaret)
		}
		if width(got) > tt.room {
			t.Errorf("fitQuery(%q, %d, %d) is %d cells", tt.query, tt.caret, tt.room, width(got))
		}
	}
}

func TestLabelsAndThePromptCannotInjectControls(t *testing.T) {
	g := fruitGroup()
	g.Label = "fruit\x1b[2J"
	m, err := New([]thing{fruit("apple", "red")}).Groups(g).Prompt("\x1b[31m> ").Build()
	if err != nil {
		t.Fatal(err)
	}
	line, _ := m.PromptLine(30)
	if s := line.String() + m.Lines(30, 1)[0].String(); strings.ContainsRune(s, '\x1b') {
		t.Errorf("a control reached the screen: %q", s)
	}
}

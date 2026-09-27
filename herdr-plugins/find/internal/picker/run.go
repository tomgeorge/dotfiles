package picker

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// Run draws the picker on the terminal and blocks until the user chooses or
// aborts. ok is false on abort, which is an ordinary outcome, not an error.
func (p *Picker[T]) Run(opts ...tea.ProgramOption) (chosen T, ok bool, err error) {
	m, err := p.Build()
	if err != nil {
		return chosen, false, err
	}
	final, err := tea.NewProgram(&program[T]{model: m, prompt: p.prompt}, opts...).Run()
	if err != nil {
		return chosen, false, fmt.Errorf("picker: %w", err)
	}
	prog := final.(*program[T])
	if prog.outcome != Accept {
		return chosen, false, nil
	}
	chosen, ok = m.SelectedItem()
	return chosen, ok, nil
}

// program adapts a Model to Bubble Tea. Everything it does beyond passing
// messages through is layout: a prompt line over the list.
type program[T Entry] struct {
	model         *Model[T]
	prompt        string
	width, height int
	outcome       Outcome
}

func (p *program[T]) Init() tea.Cmd { return nil }

// body is the rows under the prompt line: also a page, for PgUp/PgDn.
func (p *program[T]) body() int { return max(p.height-1, 0) }

func (p *program[T]) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		p.width, p.height = msg.Width, msg.Height
	case tea.KeyPressMsg:
		c, ok := command(msg.Key(), p.body())
		if !ok {
			break
		}
		if out, done := p.model.Apply(c); done {
			p.outcome = out
			return p, tea.Quit
		}
	case tea.PasteMsg:
		p.model.InsertText(msg.Content)
	}
	p.model.ScrollIntoView(p.body())
	return p, nil
}

func (p *program[T]) View() tea.View {
	t := p.model.Theme()
	lines := make([]string, 0, p.height)
	prompt, caret := p.promptLine()
	lines = append(lines, render(prompt))
	for _, l := range p.model.Lines(p.width, p.body()) {
		lines = append(lines, render(l))
	}
	// Paint the rest of the body, so the popup is one block of background.
	blank := render(Line{Spans: []Span{{strings.Repeat(" ", p.width), nil}}, Bg: t.Background})
	for len(lines) < p.height {
		lines = append(lines, blank)
	}
	v := tea.NewView(strings.Join(lines, "\n"))
	v.AltScreen = true
	v.Cursor = tea.NewCursor(caret, 0)
	return v
}

// promptLine is the prompt, the query and a matched/candidates count on the
// right, exactly p.width cells, and where the caret goes. The count gives
// way first when space runs out.
func (p *program[T]) promptLine() (Line, int) {
	m, t, w := p.model, p.model.Theme(), p.width
	count := fmt.Sprintf("%d/%d", m.Matched(), m.Candidates())
	input := w
	showCount := width(p.prompt)+1+width(count) <= w
	if showCount {
		input = w - width(count) - 1
	}
	prompt := truncate(p.prompt, input)
	query := truncate(m.Query(), input-width(prompt))
	used := width(prompt) + width(query)
	spans := []Span{
		{prompt, t.Blue},
		{query, t.Strong},
		{strings.Repeat(" ", max(input-used, 0)), nil},
	}
	if showCount {
		spans = append(spans, Span{" " + count, t.Muted})
	}
	caret := min(width(p.prompt)+m.CaretCells(), max(input-1, 0))
	return Line{Spans: spans, Bg: t.Background}, caret
}

// render turns a Line into styled terminal text.
func render(l Line) string {
	var b strings.Builder
	for _, s := range l.Spans {
		if s.Text == "" {
			continue
		}
		st := lipgloss.NewStyle()
		if s.Fg != nil {
			st = st.Foreground(s.Fg)
		}
		if l.Bg != nil {
			st = st.Background(l.Bg)
		}
		b.WriteString(st.Render(s.Text))
	}
	return b.String()
}

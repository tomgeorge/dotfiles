package picker

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// Run draws the picker on the terminal and blocks until the user chooses or
// aborts. ok is false when the user aborts, or accepts with nothing
// matching; neither is an error.
func (p *Picker[T]) Run(opts ...tea.ProgramOption) (chosen T, ok bool, err error) {
	m, err := p.Build()
	if err != nil {
		return chosen, false, err
	}
	final, err := tea.NewProgram(&program[T]{model: m}, opts...).Run()
	if err != nil {
		return chosen, false, fmt.Errorf("picker: %w", err)
	}
	if final.(*program[T]).outcome != Accepted {
		return chosen, false, nil
	}
	chosen, ok = m.Selected()
	return chosen, ok, nil
}

// program adapts a Model to Bubble Tea: keys in, the prompt line over the
// list out.
type program[T Entry] struct {
	model         *Model[T]
	width, height int
	outcome       Outcome
}

func (p *program[T]) Init() tea.Cmd { return nil }

// listHeight is the rows under the prompt line: also a page, for PgUp/PgDn.
func (p *program[T]) listHeight() int { return max(p.height-1, 0) }

func (p *program[T]) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		p.width, p.height = msg.Width, msg.Height
	case tea.KeyPressMsg:
		c, ok := commandFor(msg.Key(), p.listHeight())
		if !ok {
			break
		}
		if p.outcome = p.model.Apply(c); p.outcome != Pending {
			return p, tea.Quit
		}
	case tea.PasteMsg:
		p.model.Apply(Command{Op: Insert, Text: msg.Content})
	}
	return p, nil
}

func (p *program[T]) View() tea.View {
	lines := make([]string, 0, p.height)
	prompt, caret := p.model.PromptLine(p.width)
	lines = append(lines, render(prompt))
	for _, l := range p.model.Lines(p.width, p.listHeight()) {
		lines = append(lines, render(l))
	}
	// Paint the rest of the list, so the popup is one block of background.
	blank := render(Line{Spans: []Span{{strings.Repeat(" ", p.width), nil}}, Bg: p.model.palette.Background})
	for len(lines) < p.height {
		lines = append(lines, blank)
	}
	v := tea.NewView(strings.Join(lines, "\n"))
	v.AltScreen = true
	v.Cursor = tea.NewCursor(caret, 0)
	return v
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

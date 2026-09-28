package picker

import (
	"fmt"
	"image/color"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	// gutter is the pointer column. Every row reserves it, so a column lands
	// on the same cell whether or not its row is selected.
	gutter  = 2
	pointer = "◆"
	// lead is the rule before a divider's label, so it isn't flush left.
	lead = 3
)

// Span is a run of text in one colour. A nil Fg is the terminal's default.
type Span struct {
	Text string
	Fg   color.Color
}

// Line is one drawn row: spans on a background.
type Line struct {
	Spans []Span
	Bg    color.Color
}

// String is the line's text without colour.
func (l Line) String() string {
	var b strings.Builder
	for _, s := range l.Spans {
		b.WriteString(s.Text)
	}
	return b.String()
}

// PromptLine draws the prompt, the query and a matched/candidates count on
// the right, exactly w cells wide, and returns the column the terminal's
// cursor belongs in. The count
// gives way first, as soon as the query would otherwise be cut; past that
// the query scrolls to keep the caret in view.
func (m *Model[T]) PromptLine(w int) (Line, int) {
	prompt := truncate(m.prompt, w)
	room := w - width(prompt)
	count := fmt.Sprintf(" %d/%d", m.matched, m.candidates)
	// One more cell than the query, for the caret after it.
	showCount := width(m.query)+1+width(count) <= room
	if showCount {
		room -= width(count)
	}
	query, caret := fitQuery(m.query, m.caret, room)
	spans := []Span{
		{prompt, m.palette.Prompt},
		{query, m.palette.Query},
		{strings.Repeat(" ", max(room-width(query), 0)), nil},
	}
	if showCount {
		spans = append(spans, Span{count, m.palette.Muted})
	}
	return Line{Spans: spans, Bg: m.palette.Background}, min(width(prompt)+caret, max(w-1, 0))
}

// fitQuery fits query into room cells the way a one-line text field
// scrolls: it returns the visible part, with an ellipsis on each side that
// was cut, and the caret's cell within it. caret is in grapheme clusters.
func fitQuery(query string, caret, room int) (string, int) {
	// A trailing blank is where the caret sits when it's past the last
	// character, so the window always has a cluster to keep in view.
	cs := append(clusters(query), " ")
	caret = min(max(caret, 0), len(cs)-1)
	if width(query)+1 <= room {
		return query, width(strings.Join(cs[:caret], ""))
	}
	// Grow a window of clusters out from the caret's, leftward first so
	// typing at the end keeps the latest text in view. A side still has
	// text beyond the window while it can't reach the end, and each such
	// side costs a cell for its ellipsis.
	from, to := caret, caret+1
	used := width(cs[caret])
	fits := func(extra, from, to int) bool {
		marks := 0
		if from > 0 {
			marks++
		}
		if to < len(cs) {
			marks++
		}
		return used+extra+marks <= room
	}
	if !fits(0, from, to) {
		return "", 0
	}
	for from > 0 && fits(width(cs[from-1]), from-1, to) {
		from--
		used += width(cs[from])
	}
	for to < len(cs) && fits(width(cs[to]), from, to+1) {
		used += width(cs[to])
		to++
	}
	var b strings.Builder
	at := 0
	if from > 0 {
		b.WriteString(ellipsis)
		at = width(ellipsis)
	}
	b.WriteString(strings.Join(cs[from:to], ""))
	if to < len(cs) {
		b.WriteString(ellipsis)
	}
	return b.String(), at + width(strings.Join(cs[from:caret], ""))
}

// Lines is the window of at most height rows around the cursor, each
// exactly width cells wide. It scrolls the window as little as it can to
// keep the cursor in view.
func (m *Model[T]) Lines(width, height int) []Line {
	m.scrollIntoView(height)
	selected := -1
	if m.cursor < len(m.selectable) {
		selected = m.selectable[m.cursor]
	}
	shown := max(min(height, len(m.rows)-m.offset), 0)
	out := make([]Line, 0, shown)
	for i := m.offset; i < m.offset+shown; i++ {
		out = append(out, m.renderRow(m.rows[i], i == selected, width))
	}
	return out
}

func (m *Model[T]) renderRow(r row, selected bool, width int) Line {
	if r.divider {
		return m.dividerLine(r.group, r.count, width)
	}
	return m.entryLine(r.item, selected, width)
}

// dividerLine is a rule across the whole row with the group's label and
// match count set into it. A rule rather than a row of column headings:
// groups often run to a handful of entries, so heading rows would outnumber
// them.
func (m *Model[T]) dividerLine(group, count, w int) Line {
	rule := m.palette.Muted
	n := min(lead, max(w, 0))
	spans := []Span{{strings.Repeat("─", n), rule}}
	drawn := n
	for _, s := range []Span{
		{" " + m.groups[group].Label + " ", m.palette.Accent},
		{fmt.Sprintf("(%d) ", count), rule},
	} {
		s.Text = truncate(s.Text, w-drawn)
		drawn += width(s.Text)
		spans = append(spans, s)
	}
	spans = append(spans, Span{strings.Repeat("─", max(w-drawn, 0)), rule})
	return Line{Spans: spans, Bg: m.palette.Background}
}

func (m *Model[T]) entryLine(item int, selected bool, w int) Line {
	p := m.prepared[item]
	_, positions, _ := m.matcher.match(&p.haystack, true)

	g := min(gutter, max(w, 0))
	var spans []Span
	if selected {
		ptr := truncate(pointer, g)
		spans = append(spans, Span{ptr + strings.Repeat(" ", g-width(ptr)), m.palette.Accent})
	} else {
		spans = append(spans, Span{strings.Repeat(" ", g), nil})
	}
	drawn := g
	for i, budget := range budgets(m.groups[p.group].Columns, w) {
		f := p.fields[i]
		// budget-1 leaves a one-cell gap before the next column.
		shown := truncate(f.text, budget-1)
		spans = paint(spans, shown, shown != f.text, p.fieldStart[i], positions, f.fg, m.palette.Matched)
		spans = append(spans, Span{strings.Repeat(" ", budget-width(shown)), nil})
		drawn += budget
	}
	spans = append(spans, Span{strings.Repeat(" ", max(w-drawn, 0)), nil})

	bg := m.palette.Background
	if selected {
		bg = m.palette.Selection
	}
	return Line{Spans: spans, Bg: bg}
}

// paint appends a field's drawn text as spans, in matchFg wherever the
// matcher hit. start is where the field begins in the haystack (-1 when it
// isn't searched), and positions are the hits, as sorted rune offsets into
// the haystack. A grapheme cluster is lit if any of its runes is. When the
// text was truncated, its final ellipsis stands for dropped text and is
// never lit.
func paint(spans []Span, text string, truncated bool, start int, positions []int, fg, matchFg color.Color) []Span {
	if start < 0 || len(positions) == 0 {
		return append(spans, Span{text, fg})
	}
	cs := clusters(text)
	var run strings.Builder
	runLit, at := false, start
	flush := func() {
		if run.Len() == 0 {
			return
		}
		c := fg
		if runLit {
			c = matchFg
		}
		spans = append(spans, Span{run.String(), c})
		run.Reset()
	}
	for i, c := range cs {
		n := utf8.RuneCountInString(c)
		lit := (!truncated || i != len(cs)-1) && anyIn(positions, at, at+n)
		at += n
		if lit != runLit {
			flush()
		}
		runLit = lit
		run.WriteString(c)
	}
	flush()
	return spans
}

// anyIn reports whether sorted positions has a value in [from, to).
func anyIn(positions []int, from, to int) bool {
	i, _ := slices.BinarySearch(positions, from)
	return i < len(positions) && positions[i] < to
}

// budgets is the cells each column of a row gets. Every row of a group
// comes through here with the same columns, so alignment is one calculation
// rather than a per-row decision. The budgets never add up to more than
// width minus the gutter, and fill it exactly when there's a Fill column;
// columns past the edge get nothing.
func budgets(columns []Column, width int) []int {
	content := max(width, gutter) - gutter
	fixed, fills := 0, 0
	for _, c := range columns {
		if c.fill {
			fills++
		} else {
			fixed = saturatingAdd(fixed, c.cells)
		}
	}
	flexible := max(content-fixed, 0)
	share := 0
	if fills > 0 {
		share = flexible / fills
	}
	out := make([]int, 0, len(columns))
	remaining, left := content, fills
	for _, c := range columns {
		want := c.cells
		if c.fill {
			left--
			want = share
			if left == 0 {
				// The last fill absorbs the division remainder.
				want += flexible % fills
			}
		}
		give := min(want, remaining)
		remaining -= give
		out = append(out, give)
	}
	return out
}

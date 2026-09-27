package picker

import (
	"cmp"
	"fmt"
	"image/color"
	"math"
	"slices"
	"strings"

	"github.com/junegunn/fzf/src/util"
	"github.com/rivo/uniseg"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

const (
	// gutter is the pointer column. Every row reserves it, so a column lands
	// on the same cell whether or not its row is selected.
	gutter  = 2
	pointer = "◆"
	// lead is the rule before a divider's label, so it isn't flush left.
	lead = 3
)

// Outcome is how the user left the picker.
type Outcome int

const (
	Accept Outcome = iota + 1
	Abort
)

// row is a group's divider or an entry. A divider carries its own count, so
// the number on screen can't disagree with the rows beneath it.
type row struct {
	section bool
	group   int // section only
	count   int // section only
	item    int // entry only
}

// prepared is an entry's drawn and searchable form, computed once. bases
// ties them together: for each searchable cell, the rune offset where its
// text starts in the haystack (-1 for tags). Computing all three in one pass
// is what keeps a highlight on the text it belongs to.
type prepared struct {
	group    int
	cells    []Cell
	haystack util.Chars
	bases    []int
}

type layout struct {
	label   string
	columns []Column
	scope   rune
}

// Model is the picker without a terminal: query in, rows and lines out.
type Model[T Entry] struct {
	items    []T
	prepared []prepared
	layouts  []layout
	buckets  [][]int
	theme    theme.Theme
	matcher  *matcher

	query string
	// caret is in grapheme clusters, the unit it moves and deletes by, so it
	// can't stop between a letter and its combining mark.
	caret int

	rows []row
	// selectable are the indices in rows the cursor may occupy, so movement
	// is arithmetic and landing on a divider isn't representable.
	selectable []int
	cursor     int
	offset     int
	matched    int
	candidates int
}

func build[T Entry](items []T, groups []Group, t theme.Theme, matchPaths bool) (*Model[T], error) {
	if len(groups) == 0 {
		return nil, ErrNoGroups
	}
	index := map[string]int{}
	layouts := make([]layout, 0, len(groups))
	for i, g := range groups {
		if _, dup := index[g.Key]; dup {
			return nil, fmt.Errorf("%w: %q", ErrDuplicateGroup, g.Key)
		}
		index[g.Key] = i
		layouts = append(layouts, layout{label: g.Label, columns: g.Columns, scope: g.Scope})
	}

	m := &Model[T]{
		items:    items,
		prepared: make([]prepared, 0, len(items)),
		layouts:  layouts,
		buckets:  make([][]int, len(groups)),
		theme:    t,
		matcher:  newMatcher(),
	}
	for i, item := range items {
		g, ok := index[item.Group()]
		if !ok {
			return nil, fmt.Errorf("%w: %q", ErrUndeclaredGroup, item.Group())
		}
		cells := item.Cells(t)
		if len(cells) != len(groups[g].Columns) {
			return nil, fmt.Errorf("%w: group %q declares %d columns, an entry drew %d cells",
				ErrArity, groups[g].Key, len(groups[g].Columns), len(cells))
		}
		haystack, bases := weave(cells, item.HiddenTerms())
		m.buckets[g] = append(m.buckets[g], i)
		m.prepared = append(m.prepared, prepared{
			group:    g,
			cells:    cells,
			haystack: util.ToChars([]byte(haystack)),
			bases:    bases,
		})
	}
	initScheme(matchPaths)
	m.refresh()
	return m, nil
}

// weave builds the haystack and records where each searchable cell starts
// in it, in runes: the unit fzf reports match positions in.
func weave(cells []Cell, hidden string) (string, []int) {
	var b strings.Builder
	bases := make([]int, len(cells))
	at := 0
	for i, c := range cells {
		if !c.searchable {
			bases[i] = -1
			continue
		}
		if b.Len() > 0 {
			b.WriteByte(' ')
			at++
		}
		bases[i] = at
		at += len([]rune(c.text))
		b.WriteString(c.text)
	}
	if hidden != "" {
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(singleLine(hidden))
	}
	return b.String(), bases
}

// Theme is the palette the model draws with.
func (m *Model[T]) Theme() theme.Theme { return m.theme }

// Query is the text typed so far.
func (m *Model[T]) Query() string { return m.query }

// CaretCells is the caret's position in cells from the start of the query.
func (m *Model[T]) CaretCells() int { return width(m.query[:m.caretByte()]) }

// Matched counts the entries the query matches.
func (m *Model[T]) Matched() int { return m.matched }

// Candidates counts the entries the query could match: those in groups the
// scope shows, not every entry the picker holds.
func (m *Model[T]) Candidates() int { return m.candidates }

// Selected is the index of the entry under the cursor.
func (m *Model[T]) Selected() (int, bool) {
	if m.cursor >= len(m.selectable) {
		return 0, false
	}
	r := m.rows[m.selectable[m.cursor]]
	return r.item, !r.section
}

// SelectedItem is the entry under the cursor.
func (m *Model[T]) SelectedItem() (T, bool) {
	i, ok := m.Selected()
	if !ok {
		var zero T
		return zero, false
	}
	return m.items[i], true
}

// Apply applies one key's worth of intent. done ends the loop.
func (m *Model[T]) Apply(c Command) (out Outcome, done bool) {
	switch c.Op {
	case Insert:
		m.insert(c.Text)
	case DeleteBack:
		m.deleteBack()
	case DeleteWord:
		m.deleteWord()
	case ClearQuery:
		m.query, m.caret = "", 0
		m.refresh()
	case CaretHome:
		m.caret = 0
	case CaretEnd:
		m.caret = graphemes(m.query)
	case CaretLeft:
		m.caret = max(m.caret-1, 0)
	case CaretRight:
		m.caret = min(m.caret+1, graphemes(m.query))
	case Next:
		m.cursor = min(satAdd(m.cursor, c.N), max(len(m.selectable)-1, 0))
	case Previous:
		m.cursor = max(m.cursor-c.N, 0)
	case AcceptOp:
		return Accept, true
	case AbortOp:
		return Abort, true
	}
	return 0, false
}

func (m *Model[T]) caretByte() int {
	g := uniseg.NewGraphemes(m.query)
	for i := 0; g.Next(); i++ {
		if i == m.caret {
			start, _ := g.Positions()
			return start
		}
	}
	return len(m.query)
}

// insert puts text at the caret. The caret is re-derived from the text
// rather than incremented: a combining mark joins the cluster before it.
func (m *Model[T]) insert(text string) {
	if text == "" {
		return
	}
	at := m.caretByte()
	m.query = m.query[:at] + text + m.query[at:]
	m.caret = graphemes(m.query[:at+len(text)])
	m.refresh()
}

// InsertText inserts a bracketed paste as one edit and one refresh, reduced
// to a single line of plain text.
func (m *Model[T]) InsertText(text string) { m.insert(pasteable(text)) }

func (m *Model[T]) deleteBack() {
	if m.caret == 0 {
		return
	}
	to := m.caretByte()
	m.caret--
	from := m.caretByte()
	m.query = m.query[:from] + m.query[to:]
	m.refresh()
}

// deleteWord deletes back to the start of the previous word, like ctrl-w in
// a shell: trailing blanks first, then the word before them.
func (m *Model[T]) deleteWord() {
	to := m.caretByte()
	before := clusters(m.query[:to])
	blank := func(c string) bool { return strings.TrimSpace(c) == "" }
	keep := len(before)
	for keep > 0 && blank(before[keep-1]) {
		keep--
	}
	for keep > 0 && !blank(before[keep-1]) {
		keep--
	}
	from := len(strings.Join(before[:keep], ""))
	m.query = m.query[:from] + m.query[to:]
	m.caret = keep
	m.refresh()
}

// ScrollIntoView scrolls so the cursor is on screen in a window of height
// rows. Call it before Lines.
func (m *Model[T]) ScrollIntoView(height int) {
	if height <= 0 || m.cursor >= len(m.selectable) {
		m.offset = 0
		return
	}
	r := m.selectable[m.cursor]
	if r < m.offset {
		m.offset = r
	} else if r >= m.offset+height {
		m.offset = r + 1 - height
	}
	// An entry says nothing about which group it's in, so pull its divider on
	// screen when there's room.
	if m.offset > 0 && !m.rows[m.offset].section && m.rows[m.offset-1].section && r < m.offset+height-1 {
		m.offset--
	}
	m.offset = max(min(m.offset, len(m.rows)-height), 0)
}

// Span is a run of text in one colour.
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

// Lines is the visible window of rows, each exactly width cells wide.
func (m *Model[T]) Lines(width, height int) []Line {
	var out []Line
	selected := -1
	if m.cursor < len(m.selectable) {
		selected = m.selectable[m.cursor]
	}
	for i := m.offset; i < len(m.rows) && i < m.offset+height; i++ {
		out = append(out, m.renderRow(m.rows[i], i == selected, width))
	}
	return out
}

func (m *Model[T]) renderRow(r row, selected bool, width int) Line {
	if r.section {
		return m.sectionLine(r.group, r.count, width)
	}
	return m.itemLine(r.item, selected, width)
}

// sectionLine is a rule across the whole row with the group's name and hit
// count set into it. A rule rather than a row of column labels: groups here
// run to a handful of entries, so label rows would outnumber them.
func (m *Model[T]) sectionLine(group, count, w int) Line {
	rule := m.theme.Muted
	n := min(lead, max(w, 0))
	spans := []Span{{strings.Repeat("─", n), rule}}
	drawn := n
	for _, s := range []Span{
		{" " + m.layouts[group].label + " ", m.theme.Accent},
		{fmt.Sprintf("(%d) ", count), rule},
	} {
		s.Text = truncate(s.Text, w-drawn)
		drawn += width(s.Text)
		spans = append(spans, s)
	}
	spans = append(spans, Span{strings.Repeat("─", max(w-drawn, 0)), rule})
	return Line{Spans: spans, Bg: m.theme.Background}
}

func (m *Model[T]) itemLine(item int, selected bool, w int) Line {
	p := m.prepared[item]
	_, positions, _ := m.matcher.match(&p.haystack, true)

	g := min(gutter, max(w, 0))
	var spans []Span
	if selected {
		ptr := truncate(pointer, g)
		spans = append(spans, Span{ptr + strings.Repeat(" ", g-width(ptr)), m.theme.Accent})
	} else {
		spans = append(spans, Span{strings.Repeat(" ", g), nil})
	}
	drawn := g
	for i, budget := range budgets(m.layouts[p.group].columns, w) {
		c := p.cells[i]
		shown := truncate(c.text, budget-1)
		spans = paint(spans, shown, shown != c.text, p.bases[i], positions, c.fg, m.theme.Matched)
		spans = append(spans, Span{strings.Repeat(" ", budget-width(shown)), nil})
		drawn += budget
	}
	spans = append(spans, Span{strings.Repeat(" ", max(w-drawn, 0)), nil})

	bg := m.theme.Background
	if selected {
		bg = m.theme.Selection
	}
	return Line{Spans: spans, Bg: bg}
}

// paint appends text as spans, colouring the clusters the matcher hit. A
// cluster is hot if any of its runes is. When truncated, the final ellipsis
// stands for dropped text and is never hot.
func paint(spans []Span, text string, truncated bool, base int, positions []int, fg, hot color.Color) []Span {
	if base < 0 || len(positions) == 0 {
		return append(spans, Span{text, fg})
	}
	cs := clusters(text)
	var run strings.Builder
	runHot, at := false, base
	for i, c := range cs {
		n := len([]rune(c))
		isHot := (!truncated || i != len(cs)-1) && anyIn(positions, at, at+n)
		at += n
		if isHot != runHot && run.Len() > 0 {
			spans = append(spans, Span{run.String(), pick(runHot, hot, fg)})
			run.Reset()
		}
		runHot = isHot
		run.WriteString(c)
	}
	if run.Len() > 0 {
		spans = append(spans, Span{run.String(), pick(runHot, hot, fg)})
	}
	return spans
}

func pick(cond bool, a, b color.Color) color.Color {
	if cond {
		return a
	}
	return b
}

// anyIn reports whether sorted positions has a value in [from, to).
func anyIn(positions []int, from, to int) bool {
	i, _ := slices.BinarySearch(positions, from)
	return i < len(positions) && positions[i] < to
}

// budgets is the cells each column of a row gets. Every row of a group
// comes through here with the same columns, so alignment is one calculation
// rather than a per-row decision. The row always adds up to exactly width
// minus the gutter; columns past the edge get nothing.
func budgets(columns []Column, width int) []int {
	content := max(width-gutter, 0)
	fixed, fills := 0, 0
	for _, c := range columns {
		if c.fill {
			fills++
		} else {
			fixed = satAdd(fixed, c.cells)
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

func satAdd(a, b int) int {
	if b > 0 && a > math.MaxInt-b {
		return math.MaxInt
	}
	return a + b
}

// refresh re-runs the query and rebuilds the rows.
func (m *Model[T]) refresh() {
	prev, hadPrev := m.Selected()
	scope, needle := m.splitScope()
	m.matcher.setQuery(needle)

	m.rows, m.selectable = m.rows[:0], m.selectable[:0]
	m.matched, m.candidates = 0, 0
	type hit struct{ score, item int }
	var hits []hit
	for g, l := range m.layouts {
		if l.scope != scope {
			continue
		}
		m.candidates += len(m.buckets[g])
		hits = hits[:0]
		for _, item := range m.buckets[g] {
			if score, _, ok := m.matcher.match(&m.prepared[item].haystack, false); ok {
				hits = append(hits, hit{score, item})
			}
		}
		if len(hits) == 0 {
			continue
		}
		// Score descending; equal scores keep the order the source gave.
		slices.SortStableFunc(hits, func(a, b hit) int { return cmp.Compare(b.score, a.score) })
		m.rows = append(m.rows, row{section: true, group: g, count: len(hits)})
		m.matched += len(hits)
		for _, h := range hits {
			m.selectable = append(m.selectable, len(m.rows))
			m.rows = append(m.rows, row{item: h.item})
		}
	}

	// Keep the cursor on the same entry, so narrowing the query doesn't move
	// the selection out from under a decision already made.
	m.cursor = 0
	if hadPrev {
		for i, r := range m.selectable {
			if m.rows[r].item == prev {
				m.cursor = i
				break
			}
		}
	}
	m.offset = 0
}

// splitScope splits a leading scope character off the query. A character
// no group claims is ordinary text.
func (m *Model[T]) splitScope() (rune, string) {
	for i, r := range m.query {
		if i > 0 {
			break
		}
		for _, l := range m.layouts {
			if l.scope != 0 && l.scope == r {
				return r, m.query[len(string(r)):]
			}
		}
	}
	return 0, m.query
}

package picker

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/junegunn/fzf/src/util"
	"github.com/rivo/uniseg"
)

// Outcome is where a session stands after a command.
type Outcome int

const (
	Pending  Outcome = iota // still choosing
	Accepted                // chose the entry under the cursor, if any
	Aborted                 // left without choosing
)

// row is one line of the list: a group's divider or an entry.
type row struct {
	divider bool
	group   int // divider only
	count   int // divider only: the number of entries under it, counted as they're added
	item    int // entry only: an index into Model.items
}

// prepared is what the Model keeps per entry, computed once at build: the
// fields it draws and the haystack it's searched by. fieldStart maps between
// them: fieldStart[i] is the rune offset of field i's text in the haystack,
// or -1 when field i isn't searchable. Rendering uses it to put fzf's match
// positions back onto the field they came from.
type prepared struct {
	group      int
	fields     []Field
	haystack   util.Chars
	fieldStart []int
}

// Model is the picker without a terminal: commands in, lines out. It is
// not safe for concurrent use.
type Model[T Entry] struct {
	items    []T
	prepared []prepared // parallel to items
	groups   []Group
	byGroup  [][]int // byGroup[g] is the items in groups[g], in source order
	palette  Palette
	prompt   string
	matcher  *matcher

	query string
	// caret is in grapheme clusters, the unit it moves and deletes by, so it
	// can't stop between a letter and its combining mark.
	caret int

	rows []row // what the query shows: dividers and entries, in display order
	// selectable is the indices into rows that hold an entry. The cursor
	// indexes selectable, not rows, so it can't land on a divider.
	selectable []int
	cursor     int
	offset     int // the first row on screen
	matched    int
	candidates int
}

func build[T Entry](items []T, groups []Group, palette Palette, prompt string) (*Model[T], error) {
	if len(groups) == 0 {
		return nil, ErrNoGroups
	}
	index := map[string]int{}
	for i, g := range groups {
		if _, dup := index[g.Key]; dup {
			return nil, fmt.Errorf("%w: %q", ErrDuplicateGroup, g.Key)
		}
		index[g.Key] = i
	}

	m := &Model[T]{
		items:    items,
		prepared: make([]prepared, 0, len(items)),
		groups:   groups,
		byGroup:  make([][]int, len(groups)),
		palette:  palette,
		prompt:   prompt,
		matcher:  newMatcher(),
	}
	for i, item := range items {
		g, ok := index[item.Group()]
		if !ok {
			return nil, fmt.Errorf("%w: %q", ErrUndeclaredGroup, item.Group())
		}
		fields := slices.Clone(item.Fields())
		if len(fields) != len(groups[g].Columns) {
			return nil, fmt.Errorf("%w: group %q declares %d columns, an entry has %d fields",
				ErrArity, groups[g].Key, len(groups[g].Columns), len(fields))
		}
		haystack, fieldStart := buildHaystack(fields, item.HiddenTerms())
		m.byGroup[g] = append(m.byGroup[g], i)
		m.prepared = append(m.prepared, prepared{
			group:      g,
			fields:     fields,
			haystack:   util.ToChars([]byte(haystack)),
			fieldStart: fieldStart,
		})
	}
	ensureScheme()
	m.refresh()
	return m, nil
}

// Query is the text typed so far.
func (m *Model[T]) Query() string { return m.query }

// Matched counts the entries the query matches.
func (m *Model[T]) Matched() int { return m.matched }

// Candidates counts the entries the query could match: those in the groups
// the sigil shows, not every entry the picker holds.
func (m *Model[T]) Candidates() int { return m.candidates }

// Matches is the entries the query matches, in display order.
func (m *Model[T]) Matches() []T {
	out := make([]T, 0, len(m.selectable))
	for _, r := range m.selectable {
		out = append(out, m.items[m.rows[r].item])
	}
	return out
}

// Selected is the entry under the cursor, if anything matches.
func (m *Model[T]) Selected() (T, bool) {
	if m.cursor >= len(m.selectable) {
		var zero T
		return zero, false
	}
	return m.items[m.rows[m.selectable[m.cursor]].item], true
}

// Apply carries out one command and says whether the session is over.
func (m *Model[T]) Apply(c Command) Outcome {
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
		last := max(len(m.selectable)-1, 0)
		m.cursor = min(saturatingAdd(m.cursor, steps(c.N)), last)
	case Previous:
		m.cursor = max(m.cursor-steps(c.N), 0)
	case Accept:
		return Accepted
	case Abort:
		return Aborted
	}
	return Pending
}

// steps is how far a Next or Previous with n moves: 0 means 1, and a
// negative n goes nowhere.
func steps(n int) int {
	if n == 0 {
		return 1
	}
	return max(n, 0)
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

// insert puts text at the caret, reduced to one line of plain text so
// neither a key nor a paste can smuggle a control into the prompt. The
// caret is re-derived from the text rather than incremented: a combining
// mark joins the cluster before it.
func (m *Model[T]) insert(text string) {
	text = pasteable(text)
	if text == "" {
		return
	}
	at := m.caretByte()
	m.query = m.query[:at] + text + m.query[at:]
	m.caret = graphemes(m.query[:at+len(text)])
	m.refresh()
}

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

// scrollIntoView moves the window of height rows as little as it can to
// keep the cursor in it.
func (m *Model[T]) scrollIntoView(height int) {
	if height <= 0 || m.cursor >= len(m.selectable) {
		m.offset = 0
		return
	}
	r := m.selectable[m.cursor]
	if r < m.offset {
		m.offset = r
	} else if r-m.offset >= height {
		m.offset = r + 1 - height
	}
	// An entry doesn't say which group it's in, so bring its divider on
	// screen too when that doesn't push the cursor off the bottom.
	if m.offset > 0 && m.rows[m.offset-1].divider && r-m.offset < height-1 {
		m.offset--
	}
	m.offset = max(min(m.offset, len(m.rows)-height), 0)
}

// saturatingAdd caps at MaxInt, so a huge move or column width can't wrap
// around to a negative.
func saturatingAdd(a, b int) int {
	if b > 0 && a > math.MaxInt-b {
		return math.MaxInt
	}
	return a + b
}

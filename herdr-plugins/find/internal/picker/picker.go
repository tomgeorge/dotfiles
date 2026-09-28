// Package picker is a fuzzy list for choosing one of a set of values, drawn
// in the terminal: a popup's whole interface.
//
//	chosen, ok, err := picker.New(items).
//		Groups(picker.Group{Key: "fruit", Label: "fruits", Columns: []picker.Column{picker.Fill()}}).
//		Run()
//
// Each item is an Entry: it names its Group and returns one Field per column
// of that group. ok is false when the user backs out.
//
// Unlike piping lines through an fzf process, the picker runs in this
// process, so the value handed back is the value handed in, with no text
// format between the caller's data and its action. Owning the event loop
// buys three properties:
//
//   - What is searched is independent of what is drawn. A Tag field is drawn
//     but never searched, and an entry can add search terms it never draws.
//   - Rows can be inert. A group's divider is drawn but never matches, and
//     the cursor steps over it, so Enter can't land on a non-choice.
//   - The Model needs no terminal: commands go in and plain Lines come out,
//     so it is tested with tables rather than by scraping a screen.
//
// # Query syntax
//
// Queries are fzf's extended search:
//
//	foo      fuzzy          'foo     exact substring    'foo'  exact on word boundaries
//	^foo     prefix         foo$     suffix             ^foo$  equal
//	!foo     doesn't contain (exact)                    !'foo  doesn't fuzzy-match
//	a | b    either term    a\ b     a literal space
//
// Space-separated terms must all match. Case is smart: a term with an upper
// case letter is case-sensitive. Latin diacritics are normalised: "cafe"
// finds "café", but "café" finds only itself.
//
// Terms match an entry's searchable fields and then its hidden terms, joined
// by spaces, as one text. So ^ anchors to the start of the first searchable
// field, and $ to the end of the hidden terms, if the entry has any.
//
// A group with a Sigil is hidden until the query starts with it; see Group.
// For lists of paths, call ScorePaths before building.
//
// The design follows herdrkit's picker, MIT, github.com/joshrwolf/dots.
package picker

import (
	"errors"
	"image/color"
	"slices"

	"charm.land/lipgloss/v2"
)

// Entry is one selectable row.
type Entry interface {
	// Group is the key of the declared group the entry belongs to.
	Group() string
	// Fields returns one field per column of the entry's group, in order. It
	// is called once, when the picker is built.
	Fields() []Field
	// HiddenTerms are searched but never drawn: an id, a kind, a status shown
	// only as a glyph. Empty for none.
	HiddenTerms() string
}

// Field is what one column of a row shows.
type Field struct {
	text       string
	fg         color.Color
	searchable bool
}

// Text is a field that is drawn and searched. A nil fg is the terminal's
// default colour.
func Text(text string, fg color.Color) Field {
	return Field{text: singleLine(text), fg: fg, searchable: true}
}

// Tag is a field that is drawn but never searched: a status glyph, a marker,
// nothing a user would type to find the row.
func Tag(text string, fg color.Color) Field {
	return Field{text: singleLine(text), fg: fg}
}

// Column is one column of a group. It has no heading: a group is titled
// once, by its divider.
type Column struct {
	cells int
	fill  bool
}

// Fixed is a column n terminal cells wide, including the one-cell gap after
// its text.
func Fixed(n int) Column { return Column{cells: max(n, 0)} }

// Fill is a column that shares whatever the fixed columns leave, wherever it
// sits in the row.
func Fill() Column { return Column{fill: true} }

// Group is a run of entries sharing a set of columns. Groups keep their
// declared order and entries sort by score within their group: sorting the
// whole list would interleave groups, burying a few important entries among
// hundreds of others.
type Group struct {
	Key string
	// Label titles the group's divider. It is never searched; an entry that
	// wants its group typeable puts it in HiddenTerms.
	Label   string
	Columns []Column
	// Sigil, when non-zero, hides the group until the query starts with this
	// character, and hides every group without it once the query does. The
	// sigil is stripped before matching, so to search for a literal leading
	// sigil, type it twice. It keeps a large, low-value source out of the
	// default view.
	Sigil rune
}

// Palette is the colours the picker draws its own parts in. Entries colour
// their fields themselves. A nil colour is the terminal's default.
type Palette struct {
	Background color.Color // behind the prompt and every unselected row
	Selection  color.Color // behind the selected row
	Prompt     color.Color // the prompt before the query
	Query      color.Color // the query
	Accent     color.Color // the pointer and group labels
	Muted      color.Color // divider rules and counts
	Matched    color.Color // characters the query matched
}

// DefaultPalette uses the terminal's own colours, so it suits any
// background.
func DefaultPalette() Palette {
	return Palette{
		Prompt:  lipgloss.Blue,
		Accent:  lipgloss.Blue,
		Muted:   lipgloss.BrightBlack,
		Matched: lipgloss.Magenta,
	}
}

// Errors from Build. Each is a mistake in the calling code, reported rather
// than tolerated: an entry in an undeclared group would silently be missing
// from the list, and a field count that disagrees with the columns drops
// content or leaves a blank that reads as missing data.
var (
	ErrNoGroups        = errors.New("picker: no groups declared, so no entry could be shown")
	ErrDuplicateGroup  = errors.New("picker: group declared twice")
	ErrUndeclaredGroup = errors.New("picker: entry in an undeclared group")
	ErrArity           = errors.New("picker: field count doesn't match the group's columns")
)

// Picker configures a Model.
type Picker[T Entry] struct {
	items   []T
	groups  []Group
	prompt  string
	palette Palette
}

// New starts a picker over items.
func New[T Entry](items []T) *Picker[T] {
	return &Picker[T]{items: items, prompt: "> ", palette: DefaultPalette()}
}

// Groups declares groups, in display order.
func (p *Picker[T]) Groups(groups ...Group) *Picker[T] {
	p.groups = append(p.groups, groups...)
	return p
}

// Prompt sets the text before the query. The default is "> ".
func (p *Picker[T]) Prompt(prompt string) *Picker[T] {
	p.prompt = prompt
	return p
}

// Palette sets the colours of the picker's own parts.
func (p *Picker[T]) Palette(palette Palette) *Picker[T] {
	p.palette = palette
	return p
}

// Build validates the layout and prepares every row, without a terminal.
// The Model keeps its own copy of the item slice, the groups and each
// entry's fields, so later changes to them don't reach it. Items are copied
// by value, so anything they point to is shared.
func (p *Picker[T]) Build() (*Model[T], error) {
	groups := slices.Clone(p.groups)
	for i := range groups {
		groups[i].Label = singleLine(groups[i].Label)
		groups[i].Columns = slices.Clone(groups[i].Columns)
	}
	return build(slices.Clone(p.items), groups, p.palette, singleLine(p.prompt))
}

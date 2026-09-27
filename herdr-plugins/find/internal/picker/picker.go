// Package picker is an in-process fuzzy list for choosing one of a set of
// values: a popup's whole interface.
//
// It runs in this process, so the value handed back is the value handed in,
// with no text format between the index and the action. Owning the loop buys
// three properties:
//
//   - Match text is independent of drawn text. A Tag cell is drawn but never
//     searched, and an entry can add search terms it never draws.
//   - Rows can be inert. A group's divider renders, never matches, and the
//     cursor steps over it, so Enter can't land on a non-choice.
//   - The Model is a pure function of items, query, cursor and width, so it is
//     tested with tables rather than by scraping a terminal.
//
// The design follows herdrkit's picker, MIT, github.com/joshrwolf/dots.
package picker

import (
	"errors"
	"image/color"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

// Entry is one selectable row.
type Entry interface {
	// Group is the key of the declared group the entry belongs to.
	Group() string
	// Cells returns one cell per column of the entry's group, in order. It is
	// called once, when the picker is built. The theme is passed in so a row
	// can't be painted from a different palette than the chrome around it.
	Cells(t theme.Theme) []Cell
	// HiddenTerms are searched but never drawn: an id, a kind, a status shown
	// only as a glyph. Empty for none.
	HiddenTerms() string
}

// Cell is one drawn cell. A colour is required: a cell left to the
// terminal's default colour has nothing to recede against.
type Cell struct {
	text       string
	fg         color.Color
	searchable bool
}

// Text is a cell that is drawn and searched.
func Text(text string, fg color.Color) Cell {
	return Cell{text: singleLine(text), fg: fg, searchable: true}
}

// Tag is a cell that is drawn but never searched: a status glyph, a marker,
// nothing a user would type to find the row.
func Tag(text string, fg color.Color) Cell {
	return Cell{text: singleLine(text), fg: fg}
}

// Column is one column of a group. It has no label: a group is titled once,
// by its divider.
type Column struct {
	cells int
	fill  bool
}

// Fixed is a column of exactly cells cells.
func Fixed(cells int) Column { return Column{cells: max(cells, 0)} }

// Fill is a column that shares whatever the fixed columns leave, wherever it
// sits in the row.
func Fill() Column { return Column{fill: true} }

// Group is a run of entries sharing a set of columns. Groups keep their
// declared order and entries sort by score within their group: sorting the
// whole list would interleave kinds, burying a few agents among hundreds of
// directories.
type Group struct {
	Key string
	// Label titles the group's divider. It is chrome, never searched; an entry
	// that wants its kind typeable puts it in HiddenTerms.
	Label   string
	Columns []Column
	// Scope, when non-zero, hides the group until the query starts with this
	// character, and hides every unscoped group once it does. The character is
	// stripped before matching. It keeps a large, low-value source out of the
	// default view.
	Scope rune
}

// Errors from Build. Each is a mistake in the calling plugin, reported
// rather than tolerated: an entry in an undeclared group would silently be
// missing from the list, and a cell count that disagrees with the columns
// drops content or leaves a blank that reads as missing data.
var (
	ErrNoGroups        = errors.New("picker: no groups declared, so no entry could be shown")
	ErrDuplicateGroup  = errors.New("picker: group declared twice")
	ErrUndeclaredGroup = errors.New("picker: entry in an undeclared group")
	ErrArity           = errors.New("picker: cell count doesn't match the group's columns")
)

// Picker configures a Model.
type Picker[T Entry] struct {
	items      []T
	groups     []Group
	prompt     string
	theme      theme.Theme
	matchPaths bool
}

// New starts a picker over items, drawn in Herdr's configured theme.
func New[T Entry](items []T) *Picker[T] {
	return &Picker[T]{items: items, prompt: "> ", theme: theme.Load()}
}

// Groups declares groups, in display order.
func (p *Picker[T]) Groups(groups ...Group) *Picker[T] {
	p.groups = append(p.groups, groups...)
	return p
}

// Prompt sets the text before the query.
func (p *Picker[T]) Prompt(prompt string) *Picker[T] {
	p.prompt = prompt
	return p
}

// Theme overrides the theme loaded from Herdr's config.
func (p *Picker[T]) Theme(t theme.Theme) *Picker[T] {
	p.theme = t
	return p
}

// MatchPaths scores '/' as a word boundary, so a query matching at a path
// segment ranks above one matching mid-segment.
func (p *Picker[T]) MatchPaths() *Picker[T] {
	p.matchPaths = true
	return p
}

// Build validates the layout and prepares every row, without a terminal.
func (p *Picker[T]) Build() (*Model[T], error) {
	return build(p.items, p.groups, p.theme, p.matchPaths)
}

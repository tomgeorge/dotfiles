package picker

import (
	"errors"
	"image/color"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/tomgeorge/dotfiles/herdr-plugins/find/internal/theme"
)

var white = color.RGBA{255, 255, 255, 255}

type thing struct {
	kind, name, note string
	hidden           string
}

func fruit(name, note string) thing { return thing{kind: "fruit", name: name, note: note} }
func path(name string) thing        { return thing{kind: "path", name: name} }

func (t thing) Group() string       { return t.kind }
func (t thing) HiddenTerms() string { return t.hidden }
func (t thing) Cells(theme.Theme) []Cell {
	if t.kind == "fruit" {
		return []Cell{Tag("fruit", white), Text(t.name, white), Text(t.note, white)}
	}
	return []Cell{Tag("dir", white), Text(t.name, white)}
}

func fruitGroup() Group {
	return Group{Key: "fruit", Label: "fruits", Columns: []Column{Fixed(8), Fixed(12), Fill()}}
}

func pathGroup() Group {
	return Group{Key: "path", Label: "paths", Columns: []Column{Fixed(8), Fill()}, Scope: '/'}
}

func typed(t *testing.T, items []thing, groups []Group, query string) *Model[thing] {
	t.Helper()
	m, err := New(items).Groups(groups...).Theme(theme.Default()).Build()
	if err != nil {
		t.Fatal(err)
	}
	m.Apply(Command{Op: Insert, Text: query})
	return m
}

func model(t *testing.T, query string) *Model[thing] {
	t.Helper()
	items := []thing{
		fruit("apple", "red"),
		fruit("apricot", "orange"),
		fruit("banana", "yellow"),
		path("/tmp/apricot"),
		path("/var/log"),
	}
	return typed(t, items, []Group{fruitGroup(), pathGroup()}, query)
}

func names(m *Model[thing]) []string {
	out := []string{}
	for _, r := range m.rows {
		if !r.section {
			out = append(out, m.items[r.item].name)
		}
	}
	return out
}

func selectedName(m *Model[thing]) string {
	it, ok := m.SelectedItem()
	if !ok {
		return ""
	}
	return it.name
}

func eq[V any](t *testing.T, what string, got, want V) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s = %#v, want %#v", what, got, want)
	}
}

func lineWidth(l Line) int { return width(l.String()) }

// starts is the cell offset where each run of visible text begins. Columns
// line up exactly when these agree between rows.
func starts(l Line) []int {
	var out []int
	at, blank := 0, true
	for _, c := range clusters(l.String()) {
		if c != " " && blank {
			out = append(out, at)
		}
		blank = c == " "
		at += width(c)
	}
	return out
}

func TestEmptyQueryShowsUnscopedGroupsOnly(t *testing.T) {
	m := model(t, "")
	eq(t, "names", names(m), []string{"apple", "apricot", "banana"})
	eq(t, "matched", m.Matched(), 3)
	eq(t, "candidates", m.Candidates(), 3) // the scoped group isn't a candidate
}

func TestSigilSwapsToTheScopedGroupAndIsNotMatched(t *testing.T) {
	m := model(t, "/apri")
	eq(t, "names", names(m), []string{"/tmp/apricot"})
	eq(t, "candidates", m.Candidates(), 2)
}

func TestBareSigilShowsTheWholeScopedGroup(t *testing.T) {
	eq(t, "names", names(model(t, "/")), []string{"/tmp/apricot", "/var/log"})
}

func TestUnclaimedSigilIsOrdinaryText(t *testing.T) {
	m := typed(t, []thing{fruit("a/b", "x"), fruit("ab", "x")}, []Group{fruitGroup()}, "/")
	eq(t, "names", names(m), []string{"a/b"})
}

func TestOneDividerPerGroupAndOnlyWithHits(t *testing.T) {
	dividers := 0
	for _, r := range model(t, "").rows {
		if r.section {
			dividers++
		}
	}
	eq(t, "dividers", dividers, 1)
}

func TestDividerCountsExactlyTheItemsUnderIt(t *testing.T) {
	var counts []int
	under := 0
	for _, r := range model(t, "ap").rows {
		if r.section {
			counts = append(counts, r.count)
			under = 0
		} else {
			under++
		}
	}
	eq(t, "counts", counts, []int{2}) // apple and apricot
	eq(t, "under", under, 2)
}

func TestDividerNamesItsGroupAndShowsTheCount(t *testing.T) {
	m := model(t, "")
	drawn := m.renderRow(row{section: true, group: 0, count: 3}, false, 40).String()
	if !strings.HasPrefix(drawn, "─── fruits (3) ─") {
		t.Errorf("divider = %q", drawn)
	}
}

// A label is chrome: typing it mustn't match every row under it.
func TestGroupLabelIsNotMatchable(t *testing.T) {
	eq(t, "names", names(model(t, "fruits")), []string{})
}

func TestScoresOrderWithinAGroup(t *testing.T) {
	eq(t, "names", names(model(t, "ap")), []string{"apple", "apricot"})
	// A prefix match outranks a match inside a word.
	m := typed(t, []thing{fruit("grape", "x"), fruit("pear", "x")}, []Group{fruitGroup()}, "pe")
	eq(t, "names", names(m), []string{"pear", "grape"})
}

func TestEqualScoresKeepSourceOrder(t *testing.T) {
	m := typed(t, []thing{fruit("b", "x"), fruit("a", "x"), fruit("c", "x")}, []Group{fruitGroup()}, "")
	eq(t, "names", names(m), []string{"b", "a", "c"})
}

// Every fruit row draws "fruit" in a tag cell; a query for it would match
// all three if tags were searchable.
func TestTagCellIsDrawnButNeverMatched(t *testing.T) {
	eq(t, "names", names(model(t, "fruit")), []string{})
}

func TestHiddenTermMatchesWithoutBeingDrawn(t *testing.T) {
	it := fruit("visible", "")
	it.hidden = "w2:p1"
	m := typed(t, []thing{it, fruit("other", "")}, []Group{fruitGroup()}, "w2:p1")
	eq(t, "matched", m.Matched(), 1)
	if drawn := m.renderRow(row{item: 0}, false, 40).String(); strings.Contains(drawn, "w2") {
		t.Errorf("hidden term drawn: %q", drawn)
	}
}

func TestExtendedSearchSyntax(t *testing.T) {
	items := []thing{fruit("apple", "red"), fruit("pineapple", "yellow"), fruit("grape", "green"), fruit("café", "brown")}
	for q, want := range map[string][]string{
		"'apple":        {"apple", "pineapple"},
		"^apple":        {"apple"},
		"low$":          {"pineapple"}, // $ anchors to the end of the whole row
		"'apple !pine":  {"apple"},
		"^grape | ^app": {"apple", "grape"},
		"'apple 'red":   {"apple"}, // terms across cells AND together
		"APPLE":         {},        // an upper-case term is case-sensitive
		"'cafe":         {"café"},  // an unaccented query ignores diacritics
		"'café":         {"café"},
		"'cáfe":         {}, // an accented one doesn't
		"   ":           {"apple", "pineapple", "grape", "café"},
	} {
		m := typed(t, items, []Group{fruitGroup()}, q)
		got := names(m)
		// Order within a group is by score; compare as sets.
		if len(got) != len(want) || !sameSet(got, want) {
			t.Errorf("query %q = %q, want %q", q, got, want)
		}
	}
}

func sameSet(a, b []string) bool {
	seen := map[string]int{}
	for _, s := range a {
		seen[s]++
	}
	for _, s := range b {
		seen[s]--
	}
	for _, n := range seen {
		if n != 0 {
			return false
		}
	}
	return true
}

func TestCursorNeverLandsOnADivider(t *testing.T) {
	m := model(t, "")
	for _, op := range []Op{Next, Previous} {
		for range 20 {
			m.Apply(Command{Op: op, N: 1})
			if _, ok := m.Selected(); !ok {
				t.Fatal("nothing selected")
			}
		}
	}
}

func TestLargeNavigationSaturatesAtTheLastItem(t *testing.T) {
	m := model(t, "")
	m.Apply(Command{Op: Next, N: math.MaxInt})
	eq(t, "selected", selectedName(m), "banana")
	m.Apply(Command{Op: Previous, N: math.MaxInt})
	eq(t, "selected", selectedName(m), "apple")
}

func TestNarrowingTheQueryKeepsTheCursorOnTheSameEntry(t *testing.T) {
	m := model(t, "")
	m.Apply(Command{Op: Next, N: 1})
	eq(t, "selected", selectedName(m), "apricot")
	m.Apply(Command{Op: Insert, Text: "apr"})
	eq(t, "selected", selectedName(m), "apricot")
}

func TestEveryRowOfAGroupLandsItsColumnsOnTheSameCells(t *testing.T) {
	m := model(t, "")
	first := m.renderRow(row{item: 0}, false, 60)
	eq(t, "starts", starts(first), []int{2, 10, 22})
	for item := 1; item < 3; item++ {
		eq(t, "starts", starts(m.renderRow(row{item: item}, false, 60)), starts(first))
	}
}

func TestDividerSpansTheRowFromColumnZero(t *testing.T) {
	m := model(t, "")
	drawn := m.renderRow(row{section: true, group: 0, count: 1}, false, 60)
	eq(t, "first start", starts(drawn)[0], 0)
	eq(t, "width", lineWidth(drawn), 60)
}

// The pointer only fills the gutter; nothing past it moves when a row is
// selected, which is why the gutter is always reserved.
func TestColumnOffsetsAreTheSameWhetherARowIsSelected(t *testing.T) {
	m := model(t, "")
	past := func(l Line) []int {
		var out []int
		for _, s := range starts(l) {
			if s >= gutter {
				out = append(out, s)
			}
		}
		return out
	}
	eq(t, "offsets", past(m.renderRow(row{item: 0}, true, 60)), past(m.renderRow(row{item: 0}, false, 60)))
}

func TestEveryRenderedRowIsExactlyTheRequestedWidth(t *testing.T) {
	m := model(t, "")
	for _, w := range []int{0, 1, 2, 4, 20, 40, 60, 120} {
		for _, r := range m.rows {
			for _, sel := range []bool{false, true} {
				if got := lineWidth(m.renderRow(r, sel, w)); got != w {
					t.Errorf("%+v selected=%v at width %d drew %d", r, sel, w, got)
				}
			}
		}
	}
}

func TestRowsPaintTheThemeBackground(t *testing.T) {
	m := model(t, "")
	th := m.Theme()
	eq(t, "plain", m.renderRow(row{item: 0}, false, 40).Bg, th.Background)
	eq(t, "selected", m.renderRow(row{item: 0}, true, 40).Bg, th.Selection)
	eq(t, "section", m.renderRow(row{section: true}, false, 40).Bg, th.Background)
}

func highlighted(m *Model[thing], item int) string {
	var b strings.Builder
	for _, s := range m.renderRow(row{item: item}, false, 60).Spans {
		if s.Fg == m.Theme().Matched {
			b.WriteString(s.Text)
		}
	}
	return b.String()
}

func TestMatchedCharactersArePainted(t *testing.T) {
	eq(t, "highlight", highlighted(model(t, "appl"), 0), "appl")
}

func TestHighlightDoesNotShiftAfterClusters(t *testing.T) {
	for name, it := range map[string]thing{
		"combining mark":   fruit("cafe\u0301", "red"),
		"emoji sequence":   fruit("\U0001f468\u200d\U0001f469\u200d\U0001f467 x", "red"),
		"empty cell first": fruit("", "red"),
		"wide characters":  fruit("日本語", "red"),
	} {
		m := typed(t, []thing{it}, []Group{fruitGroup()}, "red")
		if got := highlighted(m, 0); got != "red" {
			t.Errorf("%s: highlighted %q, want red", name, got)
		}
	}
}

func TestATruncationEllipsisIsNeverHighlighted(t *testing.T) {
	// Only "longname" fits "longna…" in a 7-cell budget; the matched "m" was
	// dropped, and the ellipsis standing in for it mustn't light up.
	m := typed(t, []thing{fruit("longname", "x")},
		[]Group{{Key: "fruit", Label: "f", Columns: []Column{Fixed(0), Fixed(8), Fill()}}}, "'longnam")
	eq(t, "highlight", highlighted(m, 0), "longna")
}

func TestDeletingAWordStopsAtThePreviousBoundary(t *testing.T) {
	m := model(t, "one two")
	m.Apply(Command{Op: DeleteWord})
	eq(t, "query", m.Query(), "one ")
	m.Apply(Command{Op: DeleteWord})
	eq(t, "query", m.Query(), "")
}

func TestEditingInTheMiddleInsertsAtTheCaret(t *testing.T) {
	m := model(t, "ac")
	m.Apply(Command{Op: CaretLeft})
	m.Apply(Command{Op: Insert, Text: "b"})
	eq(t, "query", m.Query(), "abc")
	eq(t, "caret", m.CaretCells(), 2)
}

func TestPasteIsOneEditAndCannotInjectControls(t *testing.T) {
	m := model(t, "ac")
	m.Apply(Command{Op: CaretLeft})
	m.InsertText("b\nwide 一\t\x1b[31m")
	eq(t, "query", m.Query(), "ab wide 一 [31mc")
	eq(t, "caret", m.CaretCells(), width("ab wide 一 [31m"))
}

func TestMultibyteQueryEditsOnCharacterBoundaries(t *testing.T) {
	m := model(t, "日本語")
	eq(t, "caret", m.CaretCells(), 6)
	m.Apply(Command{Op: CaretLeft})
	m.Apply(Command{Op: Insert, Text: "x"})
	eq(t, "query", m.Query(), "日本x語")
	m.Apply(Command{Op: DeleteBack})
	eq(t, "query", m.Query(), "日本語")
	m.Apply(Command{Op: CaretHome})
	m.Apply(Command{Op: DeleteBack})
	eq(t, "query", m.Query(), "日本語")
}

// e + combining acute is one cluster; a caret counted in runes would stop
// inside it and split the next insert between base and mark.
func TestCaretNeverStopsInsideAGraphemeCluster(t *testing.T) {
	m := model(t, "cafe\u0301")
	eq(t, "caret", m.CaretCells(), 4)
	m.Apply(Command{Op: CaretLeft})
	m.Apply(Command{Op: Insert, Text: "x"})
	eq(t, "query", m.Query(), "cafxe\u0301")
	m.Apply(Command{Op: CaretEnd})
	m.Apply(Command{Op: DeleteBack})
	eq(t, "query", m.Query(), "cafx")
}

func TestDeletingAWordCountsAClusterAsOneUnit(t *testing.T) {
	m := model(t, "a cafe\u0301 b")
	m.Apply(Command{Op: CaretLeft})
	m.Apply(Command{Op: CaretLeft})
	m.Apply(Command{Op: DeleteWord})
	eq(t, "query", m.Query(), "a  b")
	eq(t, "caret", m.CaretCells(), 2)
}

func TestScrollingKeepsTheCursorInTheWindow(t *testing.T) {
	m := model(t, "")
	m.Apply(Command{Op: Next, N: 10})
	m.ScrollIntoView(2)
	lines := m.Lines(40, 2)
	eq(t, "lines", len(lines), 2)
	if !strings.HasPrefix(lines[1].String(), pointer) {
		t.Errorf("the selected row isn't on screen: %q", lines)
	}
}

func TestScrollingShowsTheDividerWhenThereIsRoom(t *testing.T) {
	m := model(t, "")
	m.Apply(Command{Op: Next, N: 10})
	m.ScrollIntoView(2)
	m.Apply(Command{Op: Previous, N: 10})
	m.ScrollIntoView(2)
	eq(t, "offset", m.offset, 0)
}

func TestQueryMatchingNothingLeavesNoRowsAndNoSelection(t *testing.T) {
	m := model(t, "zzzzzz")
	eq(t, "rows", len(m.rows), 0)
	if _, ok := m.Selected(); ok {
		t.Error("something is selected")
	}
	eq(t, "matched", m.Matched(), 0)
	eq(t, "lines", len(m.Lines(40, 5)), 0)
}

func TestBudgets(t *testing.T) {
	for name, tt := range map[string]struct {
		columns []Column
		width   int
		want    []int
	}{
		"fixed after a fill keeps its cells": {[]Column{Fixed(8), Fill(), Fixed(2)}, 40, []int{8, 28, 2}},
		"two fills split the remainder":      {[]Column{Fill(), Fill()}, 41, []int{19, 20}},
		"wider than the terminal is cut off": {[]Column{Fixed(20), Fixed(20), Fill()}, 24, []int{20, 2, 0}},
		"impossible totals saturate":         {[]Column{Fixed(math.MaxInt), Fixed(math.MaxInt)}, 12, []int{10, 0}},
		"narrower than the gutter":           {[]Column{Fixed(3), Fill()}, 1, []int{0, 0}},
	} {
		eq(t, name, budgets(tt.columns, tt.width), tt.want)
	}
}

func TestBuildRejectsLayoutMistakes(t *testing.T) {
	for name, tt := range map[string]struct {
		items  []thing
		groups []Group
		want   error
	}{
		"no groups":        {[]thing{fruit("apple", "red")}, nil, ErrNoGroups},
		"undeclared group": {[]thing{path("/tmp")}, []Group{fruitGroup()}, ErrUndeclaredGroup},
		"group twice":      {nil, []Group{fruitGroup(), fruitGroup()}, ErrDuplicateGroup},
		"cells vs columns": {[]thing{fruit("apple", "red")}, []Group{{Key: "fruit", Columns: []Column{Fill()}}}, ErrArity},
	} {
		if _, err := New(tt.items).Groups(tt.groups...).Theme(theme.Default()).Build(); !errors.Is(err, tt.want) {
			t.Errorf("%s: err = %v, want %v", name, err, tt.want)
		}
	}
}

func TestCellTextCannotInjectRowsOrTerminalCommands(t *testing.T) {
	eq(t, "text", Text("one\ntwo\r\x1b[31m\tend", white).text, "one\uFFFDtwo\uFFFD\uFFFD[31m end")
	eq(t, "tag", Tag("\u009b", white).text, "\uFFFD") // a C1 control too
}

func TestTruncate(t *testing.T) {
	family := "\U0001f468\u200d\U0001f469\u200d\U0001f467" // one cluster, two cells
	for _, tt := range []struct {
		in   string
		max  int
		want string
	}{
		{"hello", 5, "hello"},
		{"hello", 4, "hel…"},
		{"hello", 1, "…"},
		{"hello", 0, ""},
		{"hello", -3, ""},
		{"日本語", 4, "日…"}, // a wide char straddling the limit is dropped whole
		{family + "ab", 3, family + "…"},
		{"cafe\u0301s", 5, "cafe\u0301s"},
	} {
		got := truncate(tt.in, tt.max)
		if got != tt.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tt.in, tt.max, got, tt.want)
		}
		if width(got) > max(tt.max, 0) {
			t.Errorf("truncate(%q, %d) is %d cells", tt.in, tt.max, width(got))
		}
	}
}

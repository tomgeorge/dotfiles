package picker

import (
	"cmp"
	"slices"
	"strings"
	"unicode/utf8"
)

// buildHaystack joins an entry's searchable fields and hidden terms into
// the one string fzf searches, and records where each field starts in it,
// in runes: the unit fzf reports match positions in.
func buildHaystack(fields []Field, hidden string) (string, []int) {
	var b strings.Builder
	fieldStart := make([]int, len(fields))
	at := 0
	for i, f := range fields {
		if !f.searchable {
			fieldStart[i] = -1
			continue
		}
		if b.Len() > 0 {
			b.WriteByte(' ')
			at++
		}
		fieldStart[i] = at
		at += utf8.RuneCountInString(f.text)
		b.WriteString(f.text)
	}
	if hidden != "" {
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(singleLine(hidden))
	}
	return b.String(), fieldStart
}

// refresh re-runs the query and rebuilds the rows.
func (m *Model[T]) refresh() {
	prev := -1
	if m.cursor < len(m.selectable) {
		prev = m.rows[m.selectable[m.cursor]].item
	}
	sigil, needle := m.splitSigil()
	m.matcher.setQuery(needle)

	m.rows, m.selectable = m.rows[:0], m.selectable[:0]
	m.matched, m.candidates = 0, 0
	type hit struct{ score, item int }
	var hits []hit
	for g, group := range m.groups {
		if group.Sigil != sigil {
			continue
		}
		m.candidates += len(m.byGroup[g])
		hits = hits[:0]
		for _, item := range m.byGroup[g] {
			if score, _, ok := m.matcher.match(&m.prepared[item].haystack, false); ok {
				hits = append(hits, hit{score, item})
			}
		}
		if len(hits) == 0 {
			continue
		}
		// Score descending; equal scores keep the order the source gave.
		slices.SortStableFunc(hits, func(a, b hit) int { return cmp.Compare(b.score, a.score) })
		m.rows = append(m.rows, row{divider: true, group: g, count: len(hits)})
		m.matched += len(hits)
		for _, h := range hits {
			m.selectable = append(m.selectable, len(m.rows))
			m.rows = append(m.rows, row{item: h.item})
		}
	}

	// Keep the cursor on the same entry, so narrowing the query doesn't move
	// the selection out from under a decision already made. When the entry
	// drops out, start again from the best match.
	m.cursor = 0
	for i, r := range m.selectable {
		if m.rows[r].item == prev {
			m.cursor = i
			break
		}
	}
}

// splitSigil splits a leading sigil off the query. A character no group
// claims is ordinary text.
func (m *Model[T]) splitSigil() (rune, string) {
	r, size := utf8.DecodeRuneInString(m.query)
	for _, g := range m.groups {
		if g.Sigil != 0 && g.Sigil == r {
			return r, m.query[size:]
		}
	}
	return 0, m.query
}

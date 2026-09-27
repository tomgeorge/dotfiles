package picker

import (
	"slices"
	"strings"

	"github.com/junegunn/fzf/src/algo"
	"github.com/junegunn/fzf/src/util"
)

// The query language is fzf's extended search, ported from fzf's
// src/pattern.go (parseTerms, extendedMatch), MIT. That file lives in
// package fzf, which drags in the whole TUI, so only the algorithms are
// imported and the parser is repeated here.
//
//	foo      fuzzy          'foo     exact substring    'foo'  exact on word boundaries
//	^foo     prefix         foo$     suffix             ^foo$  equal
//	!foo     doesn't contain (exact)                    !'foo  doesn't fuzzy-match
//	a | b    either term
//
// Space-separated terms must all match. Case is smart: a term with an upper
// case letter is case-sensitive. Latin diacritics are normalised.

type termType int

const (
	termFuzzy termType = iota
	termExact
	termExactBoundary
	termPrefix
	termSuffix
	termEqual
)

type term struct {
	typ           termType
	inv           bool
	text          []rune
	caseSensitive bool
	normalize     bool
}

// pattern is an AND of term sets, each an OR of terms.
type pattern [][]term

func parsePattern(query string) pattern {
	query = strings.ReplaceAll(query, `\ `, "\t")
	var sets pattern
	var set []term
	switchSet, afterBar := false, false
	for _, token := range strings.FieldsFunc(query, func(r rune) bool { return r == ' ' }) {
		text := strings.ReplaceAll(token, "\t", " ")
		lower := strings.ToLower(text)
		caseSensitive := text != lower
		normalize := lower == string(algo.NormalizeRunes([]rune(lower)))
		if !caseSensitive {
			text = lower
		}
		if len(set) > 0 && !afterBar && text == "|" {
			switchSet, afterBar = false, true
			continue
		}
		afterBar = false

		typ, inv := termFuzzy, false
		if rest, ok := strings.CutPrefix(text, "!"); ok {
			inv, typ, text = true, termExact, rest
		}
		if text != "$" && strings.HasSuffix(text, "$") {
			typ, text = termSuffix, text[:len(text)-1]
		}
		switch {
		case len(text) > 2 && strings.HasPrefix(text, "'") && strings.HasSuffix(text, "'"):
			typ, text = termExactBoundary, text[1:len(text)-1]
		case strings.HasPrefix(text, "'"):
			// A quote flips exactness: exact for a plain term, fuzzy after !.
			if inv {
				typ = termFuzzy
			} else {
				typ = termExact
			}
			text = text[1:]
		case strings.HasPrefix(text, "^"):
			if typ == termSuffix {
				typ = termEqual
			} else {
				typ = termPrefix
			}
			text = text[1:]
		}

		if text == "" {
			continue
		}
		if switchSet {
			sets = append(sets, set)
			set = nil
		}
		runes := []rune(text)
		if normalize {
			runes = algo.NormalizeRunes(runes)
		}
		set = append(set, term{typ: typ, inv: inv, text: runes, caseSensitive: caseSensitive, normalize: normalize})
		switchSet = true
	}
	if len(set) > 0 {
		sets = append(sets, set)
	}
	return sets
}

type algoFunc func(caseSensitive, normalize, forward bool, text *util.Chars, pattern []rune, withPos bool, slab *util.Slab) (algo.Result, *[]int)

var algos = map[termType]algoFunc{
	termFuzzy:         algo.FuzzyMatchV2,
	termExact:         algo.ExactMatchNaive,
	termExactBoundary: algo.ExactMatchBoundary,
	termPrefix:        algo.PrefixMatch,
	termSuffix:        algo.SuffixMatch,
	termEqual:         algo.EqualMatch,
}

// matcher scores haystacks against one parsed query. It holds fzf's scratch
// memory, so it is not safe for concurrent use.
type matcher struct {
	pattern pattern
	slab    *util.Slab
}

// initScheme sets fzf's scoring scheme. algo keeps it in package globals and
// has no default until Init runs, so every model calls this when it's built.
// Safe here because a picker is the only matcher in its (short-lived)
// process; don't use this package from concurrent goroutines.
func initScheme(paths bool) {
	if paths {
		algo.Init("path") // '/' is a word boundary, so path segments rank higher
	} else {
		algo.Init("default")
	}
}

func newMatcher() *matcher {
	// fzf's own slab sizes.
	return &matcher{slab: util.MakeSlab(100*1024, 2048)}
}

func (m *matcher) setQuery(query string) { m.pattern = parsePattern(query) }

// match reports whether text matches and its score. With withPos it also
// returns the matched rune positions, sorted and unique.
func (m *matcher) match(text *util.Chars, withPos bool) (score int, positions []int, ok bool) {
	for _, set := range m.pattern {
		matched := false
		for _, t := range set {
			res, pos := algos[t.typ](t.caseSensitive, t.normalize, true, text, t.text, withPos, m.slab)
			found := res.Start >= 0
			if t.inv {
				if found {
					continue
				}
				matched = true
				break
			}
			if !found {
				continue
			}
			score += res.Score
			if withPos {
				if pos != nil {
					positions = append(positions, *pos...)
				} else {
					for i := res.Start; i < res.End; i++ {
						positions = append(positions, i)
					}
				}
			}
			matched = true
			break
		}
		if !matched {
			return 0, nil, false
		}
	}
	slices.Sort(positions)
	return score, slices.Compact(positions), true
}

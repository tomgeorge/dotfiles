package picker

import (
	"slices"
	"strings"
	"sync"

	"github.com/junegunn/fzf/src/algo"
	"github.com/junegunn/fzf/src/util"
)

// The query parser is ported from fzf's src/pattern.go (parseTerms,
// extendedMatch), MIT; the package doc describes the syntax. That file
// lives in package fzf, which drags in the whole TUI, so only the
// algorithms are imported and the parser is repeated here. algo and util
// are fzf's internals, with no compatibility promise: go.mod pins the
// version, and a change there needs the tests re-run, not just a build.

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
	// "\ " is an escaped literal space: park it as a tab while splitting on
	// spaces, then put it back.
	query = strings.ReplaceAll(query, `\ `, "\t")
	var sets pattern
	var set []term
	switchSet, afterBar := false, false
	for _, token := range strings.FieldsFunc(query, func(r rune) bool { return r == ' ' }) {
		text := strings.ReplaceAll(token, "\t", " ")
		lower := strings.ToLower(text)
		caseSensitive := text != lower
		// fzf's rule: fold diacritics only when the term has none, so "cafe"
		// finds "café" but "café" finds only itself.
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

// scheme records which of fzf's scoring schemes is set up. algo keeps its
// scheme in package globals and scores nothing sensibly until Init runs.
var scheme struct {
	sync.Mutex
	ready, paths bool
}

// ensureScheme sets up fzf's default scheme, unless ScorePaths already set
// up the path one.
func ensureScheme() {
	scheme.Lock()
	defer scheme.Unlock()
	if !scheme.ready {
		algo.Init("default")
		scheme.ready = true
	}
}

// ScorePaths switches fzf's scoring to its path scheme, for every picker in
// the process: fzf keeps its scheme in package globals. Under it '/' is the
// only delimiter and the start of the text counts as one, and a match after
// a space no longer outranks one after a '/'. So a query ranks entries where
// it starts a path segment first.
//
// Call it before building or using any picker. It rewrites the globals that
// matching reads, so calling it while another goroutine matches is a race;
// calling it again is harmless.
func ScorePaths() {
	scheme.Lock()
	defer scheme.Unlock()
	// One way only: "path" sets everything it changes, but "default" doesn't
	// restore the delimiters "path" replaced.
	if !scheme.paths {
		algo.Init("path")
		scheme.ready, scheme.paths = true, true
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
				// A satisfied negation carries the set, but like fzf keep
				// looking: a positive alternative still adds score and
				// highlight.
				matched = matched || !found
				continue
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

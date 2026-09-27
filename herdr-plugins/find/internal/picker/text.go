package picker

import (
	"strings"
	"unicode"

	"github.com/charmbracelet/x/ansi"
	"github.com/rivo/uniseg"
)

// Every width here is a display width in cells, never bytes or runes, and
// every cut lands on a grapheme boundary. Agent rows carry terminal titles,
// which contain wide glyphs, combining marks and emoji sequences; measuring
// per rune would shift every column to the right of one of them.

// width is the cells text occupies when printed.
func width(text string) int { return ansi.StringWidth(text) }

// graphemes counts the grapheme clusters in text.
func graphemes(text string) int { return uniseg.GraphemeClusterCount(text) }

// clusters splits text into grapheme clusters.
func clusters(text string) []string {
	var out []string
	g := uniseg.NewGraphemes(text)
	for g.Next() {
		out = append(out, g.Str())
	}
	return out
}

// ellipsis marks text that truncate cut short.
const ellipsis = "…"

// truncate clips text to max cells, ending in an ellipsis when anything was
// dropped. A cluster straddling the limit is dropped whole, so the result is
// never wider than max and what's kept is always a cluster-prefix of text.
func truncate(text string, max int) string {
	if width(text) <= max {
		return text
	}
	if max <= 0 {
		return ""
	}
	var b strings.Builder
	used := 0
	for _, c := range clusters(text) {
		w := width(c)
		if used+w > max-1 {
			break
		}
		used += w
		b.WriteString(c)
	}
	b.WriteString(ellipsis)
	return b.String()
}

// singleLine makes untrusted display text (terminal titles, paths) safe for
// a one-line row. Controls could move the cursor, add rows or inject an
// escape sequence, so tabs become spaces and every other control U+FFFD.
func singleLine(text string) string {
	if strings.IndexFunc(text, unicode.IsControl) < 0 {
		return text
	}
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t':
			return ' '
		case unicode.IsControl(r):
			return '\uFFFD'
		default:
			return r
		}
	}, text)
}

// pasteable is pasted text reduced to one query line: whitespace controls
// become spaces and other controls are dropped, so a paste can't reach the
// terminal.
func pasteable(text string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case !unicode.IsControl(r):
			return r
		case unicode.IsSpace(r):
			return ' '
		default:
			return -1
		}
	}, text)
}

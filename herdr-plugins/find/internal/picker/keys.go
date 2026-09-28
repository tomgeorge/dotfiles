package picker

import tea "charm.land/bubbletea/v2"

// Op is one edit or movement, independent of the key that produced it.
type Op int

const (
	Insert     Op = iota + 1 // insert Text at the caret
	DeleteBack               // delete the character before the caret
	DeleteWord               // delete back to the start of the previous word
	ClearQuery               // delete the whole query
	CaretHome                // move the caret to the start of the query
	CaretEnd                 // move the caret to the end of the query
	CaretLeft                // move the caret one character left
	CaretRight               // move the caret one character right
	Next                     // move the cursor N entries down
	Previous                 // move the cursor N entries up
	Accept                   // choose the entry under the cursor
	Abort                    // leave without choosing
)

// Command is an Op with its argument: Text for Insert, N for Next and
// Previous. An N of 0 moves one entry, so Command{Op: Next} does what it
// says; a negative N moves nowhere.
type Command struct {
	Op   Op
	Text string
	N    int
}

// commandFor maps a key to fzf's binding for it. page is how far a page key
// moves: whatever is on screen.
//
// The picker has the whole keyboard while it runs, Escape included; a key
// this declines does nothing.
func commandFor(k tea.Key, page int) (Command, bool) {
	// Alt chords, ctrl+alt included, belong to the terminal and the window
	// manager; typing them as text would insert a letter nobody asked for.
	if k.Mod.Contains(tea.ModAlt) {
		return Command{}, false
	}
	if k.Mod.Contains(tea.ModCtrl) {
		switch k.Code {
		case 'c', 'g', 'q':
			return Command{Op: Abort}, true
		case 'j', 'n':
			return Command{Op: Next, N: 1}, true
		case 'k', 'p':
			return Command{Op: Previous, N: 1}, true
		case 'h':
			return Command{Op: DeleteBack}, true
		case 'u':
			return Command{Op: ClearQuery}, true
		case 'w':
			return Command{Op: DeleteWord}, true
		case 'a':
			return Command{Op: CaretHome}, true
		case 'e':
			return Command{Op: CaretEnd}, true
		case 'b':
			return Command{Op: CaretLeft}, true
		case 'f':
			return Command{Op: CaretRight}, true
		}
		return Command{}, false
	}
	switch k.Code {
	case tea.KeyBackspace:
		return Command{Op: DeleteBack}, true
	case tea.KeyLeft:
		return Command{Op: CaretLeft}, true
	case tea.KeyRight:
		return Command{Op: CaretRight}, true
	case tea.KeyHome:
		return Command{Op: CaretHome}, true
	case tea.KeyEnd:
		return Command{Op: CaretEnd}, true
	case tea.KeyDown:
		return Command{Op: Next, N: 1}, true
	case tea.KeyUp:
		return Command{Op: Previous, N: 1}, true
	case tea.KeyPgDown:
		return Command{Op: Next, N: max(page, 1)}, true
	case tea.KeyPgUp:
		return Command{Op: Previous, N: max(page, 1)}, true
	case tea.KeyEnter:
		return Command{Op: Accept}, true
	case tea.KeyEscape:
		return Command{Op: Abort}, true
	}
	if k.Text != "" {
		return Command{Op: Insert, Text: k.Text}, true
	}
	return Command{}, false
}

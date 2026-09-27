package picker

import tea "charm.land/bubbletea/v2"

// Op is one edit or movement, independent of the key that produced it.
type Op int

const (
	Insert Op = iota + 1
	DeleteBack
	DeleteWord
	ClearQuery
	CaretHome
	CaretEnd
	CaretLeft
	CaretRight
	Next
	Previous
	AcceptOp
	AbortOp
)

// Command is an Op with its argument: Text for Insert, N for Next and
// Previous.
type Command struct {
	Op   Op
	Text string
	N    int
}

// command maps a key to fzf's binding for it. page is how far a page key
// moves: whatever is on screen.
//
// A popup receives every key, Escape included, so no Herdr binding can
// intercept anything. A key this declines is simply dead.
func command(k tea.Key, page int) (Command, bool) {
	ctrl := k.Mod.Contains(tea.ModCtrl)
	alt := k.Mod.Contains(tea.ModAlt)
	if ctrl {
		switch k.Code {
		case 'c', 'g', 'q':
			return Command{Op: AbortOp}, true
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
	// Alt chords belong to the terminal and the window manager; typing them
	// as text would insert a letter nobody asked for.
	if alt {
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
		return Command{Op: AcceptOp}, true
	case tea.KeyEscape:
		return Command{Op: AbortOp}, true
	}
	if k.Text != "" {
		return Command{Op: Insert, Text: pasteable(k.Text)}, true
	}
	return Command{}, false
}

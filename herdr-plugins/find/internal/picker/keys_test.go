package picker

import (
	"testing"

	tea "charm.land/bubbletea/v2"
)

func ctrl(r rune) tea.Key  { return tea.Key{Code: r, Mod: tea.ModCtrl} }
func plain(r rune) tea.Key { return tea.Key{Code: r} }

func cmd(t *testing.T, k tea.Key) Command {
	t.Helper()
	c, ok := commandFor(k, 10)
	if !ok {
		t.Fatalf("%v declined", k)
	}
	return c
}

func TestMovementMatchesFzf(t *testing.T) {
	for _, k := range []tea.Key{ctrl('j'), ctrl('n'), plain(tea.KeyDown)} {
		eq(t, k.String(), cmd(t, k), Command{Op: Next, N: 1})
	}
	for _, k := range []tea.Key{ctrl('k'), ctrl('p'), plain(tea.KeyUp)} {
		eq(t, k.String(), cmd(t, k), Command{Op: Previous, N: 1})
	}
	eq(t, "pgdown", cmd(t, plain(tea.KeyPgDown)), Command{Op: Next, N: 10})
	eq(t, "pgup", cmd(t, plain(tea.KeyPgUp)), Command{Op: Previous, N: 10})
	if c, _ := commandFor(plain(tea.KeyPgDown), 0); c.N != 1 {
		t.Errorf("a page key on an empty screen moves %d, want 1", c.N)
	}
}

func TestEditingMatchesFzf(t *testing.T) {
	for k, op := range map[tea.Key]Op{
		ctrl('h'):               DeleteBack,
		plain(tea.KeyBackspace): DeleteBack,
		ctrl('u'):               ClearQuery,
		ctrl('w'):               DeleteWord,
		ctrl('a'):               CaretHome,
		ctrl('e'):               CaretEnd,
		ctrl('b'):               CaretLeft,
		ctrl('f'):               CaretRight,
		plain(tea.KeyHome):      CaretHome,
		plain(tea.KeyEnd):       CaretEnd,
		plain(tea.KeyLeft):      CaretLeft,
		plain(tea.KeyRight):     CaretRight,
		plain(tea.KeyEnter):     Accept,
	} {
		eq(t, k.String(), cmd(t, k).Op, op)
	}
}

func TestEveryAbortKeyAborts(t *testing.T) {
	for _, k := range []tea.Key{plain(tea.KeyEscape), ctrl('c'), ctrl('g'), ctrl('q')} {
		eq(t, k.String(), cmd(t, k).Op, Abort)
	}
}

func TestTextIsTyped(t *testing.T) {
	eq(t, "A", cmd(t, tea.Key{Code: 'a', Text: "A", Mod: tea.ModShift}), Command{Op: Insert, Text: "A"})
	eq(t, "q", cmd(t, tea.Key{Code: 'q', Text: "q"}), Command{Op: Insert, Text: "q"})
	eq(t, "space", cmd(t, tea.Key{Code: tea.KeySpace, Text: " "}), Command{Op: Insert, Text: " "})
}

// Alt chords belong to the terminal and window manager, even with ctrl.
func TestAltChordsAreDeclined(t *testing.T) {
	for _, k := range []tea.Key{
		{Code: 'f', Text: "f", Mod: tea.ModAlt},
		{Code: 'q', Mod: tea.ModCtrl | tea.ModAlt},
		{Code: 'u', Mod: tea.ModCtrl | tea.ModAlt},
	} {
		if _, ok := commandFor(k, 10); ok {
			t.Errorf("%v was taken", k)
		}
	}
}

func TestUnmappedKeysAreDeclined(t *testing.T) {
	for _, k := range []tea.Key{plain(tea.KeyF5), plain(tea.KeyTab), ctrl('z')} {
		if _, ok := commandFor(k, 10); ok {
			t.Errorf("%v was taken", k)
		}
	}
}

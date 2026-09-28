# vi mode

Modal editing for Pi's prompt editor: INSERT and NORMAL modes, motions with
counts, operators, text objects, a register, undo and redo. See
`VI_MODE_PLAN.md` for the design and what's left.

## Install

`link.sh` links this directory to `~/.pi/agent/extensions/vi-mode`. For just
this extension:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi/extensions/vi-mode" ~/.pi/agent/extensions/vi-mode
```

Run `/reload` in Pi afterward, or try it once with `pi -e ./pi/extensions/vi-mode`.

## Keys

The editor starts in INSERT, which behaves like Pi's default editor. The mode,
or the command typed so far (such as `2d3`), shows at the left of the
editor's bottom border.

Commands take counts (`3w`, `2dd`, `d3w`; `2d3w` deletes six words).

| Keys | NORMAL mode |
| --- | --- |
| `h` `l` `j` `k`, Backspace | Left, right, down, up. `j` and `k` move by logical line, keeping the column |
| `w` `b` `e` `ge`, `W` `B` `E` `gE` | Word motions; the capitals treat punctuation as part of a word |
| `0` `^` `$` | Line start, first non-blank, line end |
| `gg` `G` | First or last line, or line N with a count |
| `f` `F` `t` `T`, `;` `,` | To or till a character on the line; repeat, or repeat backward |
| `%` | Matching `()`, `[]` or `{}` |
| `{` `}` | Previous or next blank line |
| `d` `c` `y` + motion or text object | Delete, change, yank. `dd` `cc` `yy` act on lines |
| `x` `X` `D` `C` `s` `S` `Y` | `dl` `dh` `d$` `c$` `cl` `cc` `yy` |
| `p` `P` | Put after or before the cursor (below or above, for lines) |
| `r`*c* `J` `~` | Replace characters, join lines, toggle case |
| `i` `a` `I` `A` `o` `O` | Enter INSERT |
| `u`, ctrl+r | Undo, redo |
| Esc | Clear a half-typed command; otherwise Pi's Esc (abort a running turn) |
| Enter | Submit, then back to INSERT |

Text objects, after `d`, `c` or `y`:

| Keys | Object |
| --- | --- |
| `iw` `aw`, `iW` `aW` | Word, with `a` taking the blanks around it |
| `i(` `a(` (`ib`, `)`), `i{` `a{` (`iB`, `}`), `i[` `a[`, `i<` `a<` | Inside or around brackets; a count picks enclosing pairs |
| `i"` `a"`, `i'` `a'`, `` i` `` `` a` `` | Inside or around quotes, on the current line |
| `ip` `ap` | Paragraph, with `a` taking the blank lines after it |

- Esc in INSERT switches to NORMAL, unless autocomplete is open, in which case
  it closes autocomplete. So aborting from INSERT takes two presses.
- Everything typed in one INSERT session undoes as one step, together with
  the `c`, `o` or `s` that started it.
- There's one register. `"_` (the black hole) discards; any other register
  name acts like the unnamed register.
- In NORMAL, unmapped printable keys do nothing. Ctrl chords, arrows and
  pastes keep their Pi meaning. In INSERT, undo stays Pi's `ctrl+-`.
- Not supported: visual mode, `.` repeat, search, macros, marks, named
  registers, and ex commands.

## How it works

- `editor.ts` subclasses Pi's `CustomEditor`. It handles modes, routes keys,
  and keeps the redo stack, which Pi's editor doesn't have.
- `engine.ts` runs NORMAL-mode commands. It's pure: given the buffer and
  cursor, it returns an action (move, edit, enter INSERT, undo, redo).
- `keys.ts` parses keys into commands. `motions.ts`, `operators.ts`,
  `textobjects.ts` and `chars.ts` are the pure pieces the engine uses.
- `bridge.ts` is the only file that touches the Pi editor's private fields.
  Pi's editor has no public way to move the cursor or replace text without
  side effects, so the bridge writes its `state` directly. At startup it
  checks those fields exist; if a Pi upgrade removed one, Pi shows an error
  and the editor behaves like the default one. Checked against Pi 0.87.1.

## Checks

```sh
node --test pi/extensions/vi-mode/*.test.ts
bash -n link.sh
```

The tests drive the engine with key strings, such as `ci(` on
`foo(a, |b) bar`. The bridge and editor were also checked against Pi's real
`Editor` with a stubbed TUI (not kept in the repository, because it imports
Pi from the Nix store), and need a manual pass in Pi after changes.

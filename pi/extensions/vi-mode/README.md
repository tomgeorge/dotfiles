# vi mode

Modal editing for Pi's prompt editor. This is the first of three stages
("Crawl"): INSERT and NORMAL modes, basic motions and a few edits. See
`VI_MODE_PLAN.md` for the rest.

## Install

`link.sh` links this directory to `~/.pi/agent/extensions/vi-mode`. For just
this extension:

```sh
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi/extensions/vi-mode" ~/.pi/agent/extensions/vi-mode
```

Run `/reload` in Pi afterward, or try it once with `pi -e ./pi/extensions/vi-mode`.

## Keys

The editor starts in INSERT, which behaves like Pi's default editor. The mode
shows at the right of the editor's bottom border.

| Keys | NORMAL mode |
| --- | --- |
| `h` `l`, Backspace | Left, right (within the line) |
| `j` `k` | Down, up by logical line, keeping the column |
| `0` `^` `$` | Line start, first non-blank, line end |
| `w` `b` `e`, `W` `B` `E` | Word motions; the capitals treat punctuation as part of a word |
| `i` `a` `I` `A` `o` `O` | Enter INSERT |
| `x` `D` `dd` | Delete a character, to line end, the line |
| `C` `cc` | Change to line end, the line (keeps the indent) |
| `u` | Undo |
| Esc | Clear a pending `d`/`c`; otherwise Pi's Esc (abort a running turn) |
| Enter | Submit, then back to INSERT |

- Esc in INSERT switches to NORMAL, unless autocomplete is open, in which case
  it closes autocomplete. So aborting from INSERT takes two presses.
- In NORMAL, other printable keys do nothing. Ctrl chords, arrows and pastes
  keep their Pi meaning.
- No counts, operators with motions, registers or text objects yet.

## How it works

`editor.ts` subclasses Pi's `CustomEditor` and routes keys. Motions and edits
are pure functions (`motions.ts`, `operators.ts`, `chars.ts`) that take the
buffer's lines and cursor.

Pi's editor has no public way to move the cursor or replace text without side
effects, so `bridge.ts` writes its private `state` directly. It's the only
file that does. At startup it checks those fields exist; if a Pi upgrade
removed one, Pi shows an error and the editor behaves like the default one.
Checked against Pi 0.87.1.

## Checks

```sh
node --test pi/extensions/vi-mode/*.test.ts
bash -n link.sh
```

The tests cover the pure modules. The bridge and key routing were checked
against Pi's real `Editor` with a stubbed TUI (not kept in the repository: it
imports Pi from the Nix store), and need a manual pass in Pi after changes.

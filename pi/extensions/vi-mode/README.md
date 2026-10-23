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
- In NORMAL, unmapped printable keys do nothing, except the leader key (see
  below). Ctrl chords, arrows and
  pastes keep their Pi meaning. In INSERT, undo stays Pi's `ctrl+-`.
- Not supported: visual mode, `.` repeat, search, macros, marks, named
  registers, and ex commands.

## Leader key

In NORMAL mode, with no command half-typed, the leader key (`SPC` by
default) opens a which-key panel below the editor listing the keys you can
press next. INSERT mode never opens it: space types a space. After `f` or
`d`, space is that command's argument, and a pasted space is text.

Inside the leader:

- A key with `+` opens its group; any other listed key runs its binding.
- Backspace goes up a level, or closes the leader at the top.
- Esc closes it. Esc never reaches Pi, so it doesn't abort a running turn.
- An unknown key closes it, and the border briefly shows the path that
  missed (`SPC c z`).

The bottom border shows the path so far (`SPC c`). Closing or running a
binding leaves NORMAL mode, the prompt, the cursor and undo as they were. A
command binding submits `/name args` from an empty prompt, so it also shows
up in prompt history.

vi-mode's own bindings:

| Keys | Runs |
| --- | --- |
| `SPC m m` `SPC m n` `SPC m t` | Select a model, next model, cycle thinking level |
| `SPC s n` `SPC s r` `SPC s t` `SPC s f` | New, resume, tree, fork the session |
| `SPC h h` `SPC h l` | `/hotkeys`, `/leader` |
| `SPC q q` | `/quit` |

Other extensions add their own groups, such as `SPC c` for crew.

### `~/.pi/agent/leader.json`

`link.sh` links it from `pi/leader.json`. It's read at every session start,
so `/reload` picks up edits:

```json
{
  "leader": "space",
  "keymap": [
    { "keys": "c", "label": "crew" },
    { "keys": "c l", "label": "list", "command": "crews" },
    { "keys": "g s", "label": "status", "command": "goal status", "detail": "current goal" },
    { "keys": "q q", "unbind": true }
  ]
}
```

- `leader` is `"space"` or one printable character that NORMAL mode leaves
  unused at the start of a command, such as `"\\"`. `d`, `,` or `1` are
  refused.
- `keys` is 1–4 space-separated keys from `a`–`z` and `0`–`9`.
- `label` with `command` binds a leaf, running `/command`. It always wins over
  vi-mode and other extensions. `detail` and `tone` (`"exit"`) are optional.
- `label` alone relabels what's at `keys`, or creates an empty group there.
- `unbind: true` removes the leaf or group. Move a binding by unbinding it
  and binding it again elsewhere.
- Any error rejects the whole file: Pi shows the errors, and the defaults
  apply.

### `/leader`

Prints the leader key, every binding with its source
(`SPC c l  crew › list  → /crews  (crew)`, or `(user)` for `leader.json`),
conflicts between extensions, and any `leader.json` errors.

### Contributing bindings from another extension

Import only `../vi-mode/leaderContract.ts`. A later contribution from the
same source replaces the earlier one, and vi-mode asks again when it loads:

```ts
import { contributeLeader } from "../vi-mode/leaderContract.ts";

const leader = contributeLeader(pi.events, "crew", [
  { id: "list", path: [{ key: "c", label: "crew" }, { key: "l", label: "list" }], command: { name: "crews" } },
]);
```

`leader.update(bindings)` changes them, and `leader.dispose()` removes them.
Bindings only run slash commands.

## How it works

- `editor.ts` subclasses Pi's `CustomEditor`. It handles modes, routes keys,
  and keeps the redo stack, which Pi's editor doesn't have.
- `engine.ts` runs NORMAL-mode commands. It's pure: given the buffer and
  cursor, it returns an action (move, edit, enter INSERT, undo, redo).
- `keys.ts` parses keys into commands. `motions.ts`, `operators.ts`,
  `textobjects.ts` and `chars.ts` are the pure pieces the engine uses.
- `leader.ts` decides each leader step and `whichKey.ts` draws the panel,
  both pure. `leaderRegistry.ts` merges `coreBindings.ts`, contributions and
  the keymap from `leaderConfig.ts` into one tree. `index.ts` wires them to
  Pi's event bus, and `editor.ts` applies the steps.
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

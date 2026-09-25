# Plan: vi mode for the Pi prompt editor

## Goal

Add vi-style modal editing to Pi's main input editor as a local extension at
`pi/extensions/vi-mode/`. Build it in three stages. Each stage should be
usable on its own:

- **Crawl:** INSERT and NORMAL modes, basic motions, and a few common edits.
  Enough to move around and fix a prompt without leaving the home row.
- **Walk:** a proper command parser with counts, the full motion set, and
  operators (`d`, `c`, `y`) combined with motions, plus registers, put, undo
  squashing, and redo.
- **Run:** text objects (`iw aw iW aW`, brackets, quotes).

Anything after that (visual mode, `.` repeat, clipboard register, search) is
optional. This targets editing prompts; full Vim parity isn't a goal. Ex
commands, macros, marks, and named registers are out of scope.

## Build or install

Three published extensions already do this (see [Prior art](#prior-art)).
If the goal is just to *use* vi mode, try `burneikis/pi-vim` first. It's the
closest to this design, and it's a good reference if we build our own later.
Building our own gives a smaller extension that matches this repository's
style, at the cost of the work below and of keeping up with Pi's private
editor fields.

## How Pi supports this

### Extension point

The installed Pi is 0.87.1. An extension replaces the main editor like this:

```ts
pi.on("session_start", (_e, ctx) => {
  ctx.ui.setEditorComponent((tui, theme, kb) => new ViEditor(tui, theme, kb));
});
```

- `docs/tui.md` says to extend `CustomEditor`, which keeps app shortcuts and
  agent controls working. Keys our editor doesn't handle go to
  `super.handleInput`. `setEditorComponent(undefined)` restores the default
  (`docs/extensions.md:2555–2560`).
- `examples/extensions/modal-editor.ts` (85 lines) is a starting skeleton:
  - A mode field that starts in INSERT.
  - Esc switches INSERT to NORMAL. In NORMAL, Esc passes through to Pi,
    which aborts the running turn.
  - `hjkl 0 $ x i a` are remapped to terminal key sequences.
  - A mode label is drawn by patching `render()` output.

  Remapping to key sequences is **wrong** for real motions (see "Why not
  replay keys?").
- Only one editor component can be active. The last extension to call
  `setEditorComponent` wins, so this conflicts with any other extension that
  replaces the editor. None is installed today.

### `CustomEditor` input order

`dist/modes/interactive/components/custom-editor.js` checks keys in this
order:

1. Extension shortcuts.
2. `app.clipboard.pasteImage` (`ctrl+v`).
3. `app.interrupt` (Esc): aborts, unless autocomplete is open.
4. `app.exit` (`ctrl+d`) when the editor is empty.
5. Other app actions (`ctrl+r` rename session, `ctrl+g` external editor,
   model cycling, and so on).
6. The base `Editor.handleInput`.

Our `handleInput` override runs before all of these, so it decides what
reaches Pi.

| Key | Pi default | vi meaning | Resolution |
| --- | --- | --- | --- |
| Esc | abort | INSERT → NORMAL | In INSERT, switch to NORMAL; if autocomplete is open, pass the key to `super` to close it. In NORMAL, pass to `super` to abort. |
| `ctrl+r` | rename session | redo | Redo in NORMAL only (from Walk). Pass through in INSERT. |
| `ctrl+v` | paste image | visual block | Leave to Pi. Visual block is out of scope. |
| `ctrl+c`, `ctrl+d`, `ctrl+g`, `ctrl+l`, `ctrl+p` | app actions | none we need | Always pass to `super`. |
| Enter | submit | move down a line | Submit in both modes, as users expect in a prompt. |
| Printable keys in NORMAL | type text | commands | Handle as commands, and ignore unmapped keys. Never insert text in NORMAL. |

### The editor's API

`@earendil-works/pi-tui`'s `Editor` has these public methods: `getText`,
`setText`, `getLines`, `getCursor`, `insertTextAtCursor`, `getExpandedText`,
`isShowingAutocomplete`, `render`, and `handleInput`. `tui` is protected.
There's **no public way to set the cursor or replace text without side
effects.**

TypeScript `private` fields are still reachable at runtime. I checked that
each of these exists in the installed Pi:

- `state: { lines: string[]; cursorLine: number; cursorCol: number }`
- `setCursorCol(col)`, which also resets the sticky visual column
- `pushUndoSnapshot()`, which `structuredClone`s `{state, pastes,
  pasteCounter}` onto `undoStack` (an `UndoStack` with a `.stack` array)
- `undo()`, `lastAction`, `pastes: Map<number, string>`, `pasteCounter`,
  and `onChange`

The earlier plan assumed a protected `renderBottomBorder`, but it **doesn't
exist in this version**. The mode label has to be added by post-processing
`render()` output, as the example does.

### Why not replay keys or use `setText`?

My first plan applied motions by sending arrow and `ctrl` sequences to
`super.handleInput`, and edits with `setText()`. That's broken in three ways:

- **Wrapped lines:** the base editor moves up and down by visual (wrapped)
  rows, and pressing up on the top line opens history. `j`, `k`, `gg`, and
  `G` must move by logical lines.
- **Paste markers:** `setText()` clears `pastes` and `pasteCounter`. Collapsed
  paste markers such as `[paste #1 +40 lines]` would then be submitted as the
  literal marker text, not the pasted content.
- **Remapped keys:** replayed sequences break if the user remaps keybindings.

So this plan writes `state` directly through a small bridge, and computes
motions in pure code.

### Prior art

| Repository | Size | Approach | Notes |
| --- | --- | --- | --- |
| [`burneikis/pi-vim`](https://github.com/burneikis/pi-vim) | ~4.7k LOC | `CustomEditor` subclass. Pure `motions.ts`, `text-objects.ts`, `operators.ts`. Sets the cursor by writing `state` (`cursor.ts`). | Closest to this plan. Handles paste markers, DECSCUSR cursor shapes, and redo. |
| [`lajarre/pi-vim`](https://github.com/lajarre/pi-vim) | ~4.2k-line `index.ts` | Monolithic. Writes `state` and `undoStack.stack` directly. | Insert session undoes as one step, redo, `.` repeat, and `:cmd` runs Pi slash commands. |
| [`pekochan069/pi-vimmode`](https://github.com/pekochan069/pi-vimmode) (`npm:pi-vimmode`) | ~22k LOC | Pure text-plus-cursor functions. Applies edits with `setText`, then moves the cursor by replaying arrow keys. | Most features: visual/block, ex, macros, easymotion, large config. Much bigger than we need. |

Clones for reading were in `/tmp/{bpv,lpv,pvm}`. `/tmp` may be cleared, so
re-clone if needed.

## Design

### Layout

```
pi/extensions/vi-mode/
  index.ts           # registers the editor factory on session_start
  editor.ts          # ViEditor extends CustomEditor: key routing, modes, rendering
  bridge.ts          # the only file that touches Editor private fields
  keys.ts            # command parser: count, register, operator, motion/object
  motions.ts         # pure: (lines, cursor, count, arg?) -> Motion
  textobjects.ts     # pure: (lines, cursor, count, inner) -> Range | null   (Run)
  operators.ts       # pure: apply d/c/y to (lines, range) -> Edit          (Walk)
  chars.ts           # character classes: word, WORD, blank
  *.test.ts          # node --test
  README.md
```

The pure modules work on `lines: string[]` and `Pos = {line, col}`, and
import nothing from Pi. `node --test pi/extensions/vi-mode/*.test.ts` runs
them with Node's built-in type stripping, as the subagent extension's tests
do. Link the extension in `link.sh` next to `subagent`:
`link pi/extensions/vi-mode ~/.pi/agent/extensions/vi-mode`.

### Core types

```ts
type Pos = { line: number; col: number };
type MotionKind = "exclusive" | "inclusive" | "linewise";
type Motion = { to: Pos; kind: MotionKind } | null;       // null = no-op
type Range = { start: Pos; end: Pos; kind: MotionKind };  // end inclusive for "inclusive"
type Edit = { lines: string[]; cursor: Pos; register?: Register };
type Register = { text: string; linewise: boolean };
```

### Bridge (`bridge.ts`)

```ts
getLines(): string[]            // public API
getCursor(): Pos                // public API
setCursor(pos)                  // state.cursorLine + setCursorCol + lastAction = null
applyEdit(lines, cursor)        // pushUndoSnapshot; state.lines = lines; setCursor; onChange?.(text)
undoDepth(): number             // undoStack.stack.length            (Walk)
squashUndoTo(depth)             // drop snapshots after `depth`      (Walk)
undo()                          // base undo()
```

- On startup, check the shapes of these fields. If any is missing, show an
  error that includes the Pi version, and leave the default editor in place.
  Don't misbehave silently.
- Call `tui.requestRender()` after each change, unless the base editor
  already does. Check this while implementing.

### Modes and key routing (`editor.ts`)

```
handleInput(data):
  bracketed paste                                   -> super   (always inserts text)
  Pi app key we never own (ctrl+c/d/g/l/p/…)        -> super
  INSERT:
    Esc & autocomplete open -> super (close menu)
    Esc                     -> end insert session, cursor left 1, mode = NORMAL
    else                    -> super
  NORMAL / operator pending:
    Esc with pending keys   -> clear pending
    Esc when idle           -> super (abort)
    Enter                   -> super (submit)
    printable / ctrl+r      -> parser.feed(key) -> execute
    other                   -> ignore
```

- Vim rule: in NORMAL the cursor sits **on** a character. Clamp `col` to
  `len - 1`, or 0 on an empty line. INSERT allows `col == len`.
- Start in INSERT, so typing works immediately. Use a constant for now.

### Rendering

- Add ` NORMAL `, ` INSERT `, or the pending keys (such as ` d2i `) to the
  right edge of the bottom border line from `render()`. Use `visibleWidth`
  and `truncateToWidth`, and account for the scroll indicator.
- Optional: set the cursor shape per mode with DECSCUSR. `\x1b[2 q` (block)
  in NORMAL and `\x1b[6 q` (bar) in INSERT, reset with `\x1b[0 q` on
  `session_shutdown`. Ghostty, WezTerm, and tmux support it. The base
  editor draws a reverse-video cell that looks like a block in both modes;
  `burneikis/pi-vim` hides it in INSERT and shows the hardware cursor with
  `tui.setShowHardwareCursor` (which exists in this version).

## Stages

### Crawl: modes, basic motions, basic edits

A first version that's pleasant to use, without a real parser.

**Scope:**
- `index.ts`, `ViEditor`, and `bridge.ts` with shape checks. Link in
  `link.sh`.
- INSERT/NORMAL switching and Esc handling (autocomplete, abort). Enter
  submits in both modes.
- Mode label in the bottom border.
- Entering INSERT: `i a I A o O`.
- Motions, computed in `motions.ts` / `chars.ts` and applied with
  `setCursor`:
  - `h l`: exclusive, stop at line edges.
  - `j k`: logical lines, with a sticky wanted column.
  - `0 ^ $`.
  - `w b e`, crossing lines, with Vim's three character classes (word
    characters `[\p{L}\p{N}_]`, other non-blank, blank). An empty line
    counts as a word.
- Edits, each one `applyEdit` so one `u` undoes it:
  - `x`
  - `dd D` (hard-coded; no general operator yet)
  - `cc C` (enter INSERT)
- `u` using the base `undo()`.
- A two-key `dd`/`cc` just needs a "pending `d`/`c`" flag. Any other key
  clears it.

**Tests:** character classes; `w`/`b`/`e` across lines and punctuation;
`j`/`k` wanted column and short lines; `^`; `dd` on the first, middle, last,
and only line; normal-mode cursor clamping.

**Manual checks:** submit from both modes. Esc from NORMAL aborts a running
turn. Esc closes autocomplete first. Paste text and images. `ctrl+g` opens
the external editor. Up arrow in INSERT browses history. Slash-command
autocomplete works. A collapsed paste still submits its full content after
motions and `dd` elsewhere in the buffer.

### Walk: parser, counts, operators, registers

Replace Crawl's ad-hoc handling with the command grammar, and add the rest
of the motions and the operators.

**Command grammar (`keys.ts`)** is a state machine fed one key at a time:

```
[count] ["x] ( motion
             | operator [count] ( motion | textobject | same-operator )   # dd, cc, yy
             | simple-command )                                           # x X D C s S p P r{c} J ~ u ^R i a I A o O
```

- Counts multiply: `2d3w` deletes 6 words.
- Pending states: `g` (`gg ge gE`), `f/F/t/T` and `r` waiting for a
  character, and `"` waiting for a register name. After an operator, `i`/`a`
  wait for a text object (Run).
- The parser returns a command object, and `editor.ts` executes it through
  the bridge. Tests feed key strings such as `"d3w"` and check the parsed
  command.

**Motions (`motions.ts`):**

| Motion | Kind | Notes |
| --- | --- | --- |
| `h` `l` | exclusive | Already in Crawl. `l` can't move past the last character in NORMAL. |
| `j` `k` | linewise | Already in Crawl. `$` sets the wanted column to infinity. |
| `gj` `gk` | exclusive | Visual rows, delegated to the base arrow keys. Optional, but prompts wrap a lot. |
| `w` `b` `e` `ge` | excl / excl / incl / incl | Add `ge` and counts. |
| `W` `B` `E` `gE` | same | 2 classes: blank and non-blank. |
| `0` `^` `$` | excl / excl / incl | `0` is a motion only when no count is pending. `N$` moves N−1 lines down. |
| `gg` `G` | linewise | `NG` or `Ngg` goes to line N, landing on the first non-blank character. |
| `f` `F` `t` `T`, `;` `,` | incl / excl | Current line only. Remember the last search for `;` and `,`. |
| `%` | inclusive | Matching `()[]{}`. First scans forward on the line for a bracket. |
| `{` `}` | exclusive | Paragraph motions (blank-line delimited). |

Vim special cases people notice:
- `cw`/`cW` on a non-blank character act like `ce`/`cE`.
- If `dw` would move to another line, it stops at the end of the current
  line (`:h exclusive`).
- Nice-to-have: an exclusive motion that ends at column 0 and starts at or
  before the first non-blank becomes linewise (`:h exclusive-linewise`).

**Operators (`operators.ts`)** take `(lines, Range)` and return an `Edit`:
- `d`: delete into the register. Linewise deletes remove whole lines, and
  the cursor goes to the first non-blank character of the next line.
- `c`: delete, then INSERT. A linewise change keeps one empty line with the
  indent.
- `y`: yank. The cursor goes to the start of the range.
- Optional: `>` `<` (indent) and `g~` `gu` `gU` (case).
- Shortcuts: `x`=`dl`, `X`=`dh`, `D`=`d$`, `C`=`c$`, `s`=`cl`, `S`=`cc`,
  `Y`=`yy`. Crawl's hard-coded `x dd D cc C` move onto the operators.
- `p`/`P` depend on whether the register is charwise or linewise. `r{c}`,
  `J`, and `~` are small standalone edits.

**Registers:** only the unnamed register. Keep the `"x` parser state so a
named register or `"+` (clipboard via `pbcopy`) can be added later without
a redesign.

**Undo and redo:**
- Each NORMAL edit is one `applyEdit`, which takes one snapshot.
- For an insert session (`i`, `a`, `o`, `c…`), record `undoDepth()` on entry,
  and call `squashUndoTo(depth)` on Esc, so the whole session undoes as one
  step. A `c` deletion belongs to the same step.
- Redo (`ctrl+r`) uses our own stack. `u` pushes the current `{lines,
  cursor}` onto it, and any new edit clears it. It doesn't interact with the
  base undo stack.
- In INSERT, undo stays Pi's `ctrl+-`.

**Tests:** parser (counts, multiplied counts, pending states, Esc cancels);
every motion including counts, `f`/`t` with `;`/`,`, `%`, `gg`/`G`; the
`cw` and `dw` special cases; linewise and charwise put; undo squashing.

### Run: text objects

Add `textobjects.ts`. Each object takes `(lines, cursor, count, inner)` and
returns a `Range` or `null`.

**Words: `iw aw iW aW`**
- `iw`: the run of same-class characters under the cursor. A run of blanks
  counts as an object too.
- `aw`: the word plus trailing blanks. If there are none, it takes the
  leading blanks instead. If the cursor starts on blanks, it takes the
  blanks plus the next word.
- A count extends over N objects. Each word run and blank run counts as one.

**Brackets: `( ) b`, `{ } B`, `[ ]`, `< >`**
- Search backward for an unmatched opener, counting nesting. A cursor **on**
  a bracket counts as inside that pair. Then search forward for the
  matching closer. Both searches cross lines.
- A count selects outer levels: `2i(` is the enclosing pair.
- `a(` includes the brackets and `i(` excludes them. When the brackets are
  adjacent, `i(` is empty: `ci(` inserts between them and `di(` does
  nothing.
- Multi-line `i{`: if the opener ends its line and the closer starts its line
  (after indentation), the inner range is the whole lines between them,
  **linewise**. So `di{` leaves `{` and `}` on their own lines, as in Vim.
- No escape or string awareness, as in Vim.

**Quotes: `" ' \``**
- Current line only, as in Vim. Pair quotes from the start of the line and
  skip backslash-escaped quotes.
- A cursor on a quote opens or closes depending on its position in the
  pairing. If the cursor is before the first quote, use the next quoted
  string.
- `i"` excludes the quotes. `a"` includes them plus trailing whitespace, or
  leading whitespace if there's no trailing whitespace. Counts: skip.

**Tests:** nesting, multi-line pairs, cursor on a delimiter, empty pairs,
escaped quotes, and a cursor before the first quote.

### Later, if wanted

- `.` repeat: record the last change as keys plus the inserted text.
- `v` and `V` visual mode. Selection highlighting means post-processing
  rendered lines, which contain ANSI codes and wrapping. That's why it's
  deferred.
- `ip`/`ap` paragraph objects, useful for multi-line prompts.
- The `"+` clipboard register, `/` search, cursor shapes.
- Paste-marker-safe motions: treat a marker as one WORD so `dw` can't split
  it. Until then, `u` fixes a broken marker.

## Testing

- Pure-module tests with `node:test` and `node:assert/strict`, table-driven,
  with `|` marking the cursor:

  ```ts
  case("dd", "one\n|two\nthree", "one\n|three");
  case("ci(", "foo(a, |b) bar", "foo(|) bar", "INSERT");
  case("daw", "one |two three", "one |three");
  case("di{", "if {\n  |x\n}", "if {\n|}");
  ```

- Run with `node --test pi/extensions/vi-mode/*.test.ts`.
- The bridge and editor are tested by hand in Pi (`pi -e
  ./pi/extensions/vi-mode`). `CustomEditor` needs a real `TUI` and
  keybindings manager; a stub-based headless test is possible but not worth
  it yet.
- Repeat the Crawl manual checklist at each stage.

## Risks

- **Private API drift.** A Pi upgrade through nixpkgs could rename `state`,
  `undoStack`, or `setCursorCol`. Mitigation: keep all private access in the
  bridge, check shapes at startup, and fall back to the default editor with
  a clear error. `renderBottomBorder` has already turned out to be missing
  from the version we have.
- **Other editor extensions.** Only one editor component can be active.
  Check before installing packages that replace the editor, such as
  `pi-prompt-history`.
- **Esc latency.** Terminals send Esc as the first byte of escape sequences.
  Confirm that a plain Esc in INSERT registers immediately and that Alt+key
  combinations aren't split.
- **Paste markers.** Until paste-marker-safe motions are added, motions can
  split a marker. `u` restores it.

## Open questions

1. **Build or install?** Try `burneikis/pi-vim` first, or go straight to
   Crawl?
2. **Aborting takes two Esc presses from INSERT** (one to leave INSERT, one
   to abort). Is that acceptable, or do you want another abort key?
3. **Cursor shapes:** do you want them in Crawl, or later?

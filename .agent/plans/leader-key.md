# A leader key and which-key map for Pi's prompt editor

This ExecPlan is a living document. Keep the Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective sections up to date as the work proceeds. It follows `pi/prompts/execplan.md`. Start a session with `/execplan continue .agent/plans/leader-key.md`.

## Purpose

Today three Pi extensions in this repo each claim their own `ctrl+shift` chord to open a panel (`ctrl+shift+c` crew, `ctrl+shift+s` subagents, `ctrl+shift+w` watches). Every new extension needs another chord, the chords collide with terminal and multiplexer bindings, and nothing in Pi shows what is bound.

After this change, Pi's prompt editor has a **leader key** in the style of Doom Emacs, and the chords are gone:
- In vi NORMAL mode, with no command half-typed, press the leader key (`SPC` by default). A **which-key panel** opens below the editor and lists the keys you can press next. INSERT mode is untouched: space always types a space.
- Each key narrows the map: `SPC c` shows the crew group, then `l` runs its "list crews" binding. `Backspace` goes up one level, and `Esc` or an unknown key closes the leader. The prompt text, the cursor, and the mode are as they were.
- Extensions add bindings to one shared registry instead of claiming chords. The crew, subagent, watch, and goal extensions contribute their own groups. vi-mode adds core groups for models, sessions, help, and quit.
- The leader key and the key map are configurable in `~/.pi/agent/leader.json`, which `link.sh` links from `pi/leader.json` in this repo. You can change the leader key, add bindings, rebind keys, relabel groups, and remove bindings. The file is read at every session start, so `/reload` picks up edits.
- `/leader` prints the current key tree, where each binding came from, any conflicts, and any errors in `leader.json`.
- A new `/crews` command lists every crew in the repository and opens the one you pick. `SPC c l` runs it.
- The `ctrl+shift+c`, `ctrl+shift+s`, and `ctrl+shift+w` shortcuts are removed. Their panels open from the leader or from `/crew-status`, `/subagents`, and `/watches`.

How to see it working: reload Pi in `~/git/dotfiles`, press `Esc` to enter NORMAL mode, and press `SPC`. The panel appears with groups `a` agents, `c` crew, `g` goal, `h` help, `m` models, `q` quit, `s` sessions, and `w` watches. Press `c` then `s`, and the crew panel opens.

## Context

### Where things live

This is the dotfiles repository at `~/git/dotfiles`.
- **Loading.** Pi (a coding-agent CLI, version 1.0.2 here) loads extensions from `~/.pi/agent/extensions/<name>/index.ts`. `link.sh` symlinks each extension directory separately, for example `pi/extensions/vi-mode` to `~/.pi/agent/extensions/vi-mode`. It links config files the same way, for example `link pi/subagent-routes.json ~/.pi/agent/subagent-routes.json`.
- **Cross-extension imports.** One extension can import another's files with a relative path such as `../vi-mode/leaderContract.ts`, but only if the target directory is linked too. `vi-mode` already is.
- **Config files.** `pi/extensions/subagent/router.ts` shows the pattern for an extension config file: `CONFIG_PATH = join(homedir(), ".pi", "agent", "subagent-routes.json")`, parsed and validated with clear errors.
- **Language and tests.** Extensions are TypeScript, loaded by Pi through jiti with no build step. Tests use `node:test` under Node 24 type stripping. Run them with `node --test <files>` and read the result with `rg '^ℹ (tests|pass|fail)'`, not TAP's `# pass`.
- **Test harness.** `pi/extensions/test-support/fake-pi.ts` is a stand-in for Pi's extension API (`fakePi()`), and it stubs Pi's packages (`@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`) so tests run outside Pi. In the stub, `matchesKey(data, id)` is `data === id`, and `CustomEditor` is an empty class. Today `fakePi()` has no `events` and no `getCommands`. Milestone 3 adds both.
- **Type check.** `pi/extensions/test-support/typecheck.sh` type-checks every extension against the installed Pi. This machine has no `tsc`, so run it as `nix shell nixpkgs#typescript -c bash pi/extensions/test-support/typecheck.sh`.
- **API types.** The Pi extension API is in `/nix/store/8pm5imbp5660gq107j5aj0qdxgmnxy6s-pi-coding-agent-1.0.2/lib/node_modules/pi-monorepo/dist/core/extensions/types.d.ts`, and the editor base class is in `.../dist/modes/interactive/components/custom-editor.d.ts`.
- **Background reading.** `.agent/rfd/0001-leader-key.html` is the design discussion this plan implements (RFD stands for "request for discussion"). `IDEAS.md` has the original entry, "Doom-style leader key". This plan overrides the RFD in three places, recorded in the Decision Log: the leader is NORMAL-mode only, `ctrl+space` is dropped, and the chords are removed.

### Terms

- **Leader**: a short-lived editor state, entered with the leader key, in which each key walks one step down a tree of bindings.
- **Leader key**: the key that opens the leader. The default is `SPC` (space), and it's configurable.
- **Path**: the keys pressed since the leader opened, for example `["c", "l"]`. It's shown as `SPC c l`, using the configured leader key's name.
- **Segment**: one step of a path: a key (one character from `a`–`z` or `0`–`9`), a label, an optional grey detail line, and an optional tone.
- **Binding**: a full path plus a **target**, which is what runs at the end. A target is either a slash command (`{ command: { name, args? } }`, which submits `/name args`) or, only for vi-mode's built-in core bindings, a Pi app action (`{ app: "app.model.select" }`).
- **Group**: a node with children. Only groups are shown in the panel.
- **Contribution**: `{ source, bindings }` from one extension, for example `{ source: "crew", bindings: [...] }`. A new contribution from the same source replaces that source's earlier one.
- **Registry**: the code that turns all contributions into one tree and reports conflicts. It works in four steps:
  1. It validates each incoming contribution once, and rejects a malformed one whole.
  2. It merges the core bindings, then every contribution in registration order, then the user keymap.
  3. When two sources claim the same keys, the later one wins and the clash is reported. The tree is rebuilt from every stored contribution, so a displaced binding comes back when the winner unregisters.
  4. It answers "what are the options under this path?" for the panel and the key-step logic.
- **User keymap**: the `keymap` list in `leader.json`. It's applied last, so it always wins. It can also remove bindings.
- **Which-key panel**: the grid of next keys drawn below the editor while the leader is open. The name comes from the Emacs package `which-key`.
- **Tone**: how a key badge is coloured. `"exit"` (yellow) marks a binding that leaves something active, such as `SPC c x` to stop a running crew.
- **App action**: a named Pi editor action such as `app.model.select`. Pi puts handlers for these in the editor's public `actionHandlers` map.
- **DoomPi**: an open-source Pi distribution (https://github.com/AgiFlow/doompi, MIT licence). We port its leader registry. We refer to its files at commit `c3f057ab58a94667fb6f5c1e94c5a31e43bf84cf`.

### The vi-mode extension today

`pi/extensions/vi-mode/` replaces Pi's prompt editor with `ViEditor`, a subclass of Pi's `CustomEditor` defined in `editor.ts`. `index.ts` installs it on `session_start` with `ctx.ui.setEditorComponent`.
- **One editor slot.** Pi allows only one editor component, so the leader must live inside `ViEditor`.
- **Modes.** `ViEditor` has two modes, `"insert"` and `"normal"`. `handleInput(data)` routes every key. First it checks whether this Pi's editor has the internal fields the bridge needs (`missing`). Then it runs the bracketed-paste guard (`trackPaste`), and then it calls `insertKey` or `normalKey`.
- **NORMAL-mode commands.** These are parsed by the pure `Engine` in `engine.ts`, which uses the grammar in `keys.ts`. `engine.pending` holds a half-typed command such as `2d`.
  - At the start of a command, `keys.ts` gives meaning to: the counts `1`–`9`; `"` (register); the motions `h l j k 0 ^ $ w b e W B E G ; , % { }`; `g`; `f F t T`; the operators `d c y`; `r`; and the simple keys `x X D C s S Y p P J ~ u i a I A o O`.
  - Every other printable key, including space, does nothing at the start of a command. Only those unused keys may be the leader key.
- **Mode label.** `renderBottomBorder` writes the pending command or `NORMAL`/`INSERT` into the editor's bottom border. That slot will also show the leader path.
- **Bridge.** `bridge.ts` reaches into private fields of Pi's editor. The leader must use only public API (`getText`, `setText`, `onSubmit`, `actionHandlers`).
- **How vi-mode is structured.** Pure modules decide what happens, and `editor.ts` applies it. The leader follows the same split.

### How Pi wires a custom editor (checked in Pi 1.0.2's `dist/modes/interactive/interactive-mode.js`)

- After the editor factory returns, Pi sets `onSubmit` and `onChange`, copies the current text in, and copies `onEscape`, `onCtrlD`, and every handler in `actionHandlers` from its default editor. **The editor must read `this.actionHandlers` and `this.onSubmit` when a binding runs, not in the constructor.**
- `actionHandlers` exist for `app.model.select`, `app.model.cycleForward`, `app.model.cycleBackward`, `app.thinking.cycle`, `app.thinking.toggle`, `app.session.new`, `app.session.resume`, `app.session.tree`, and `app.session.fork`, among others. There is **no** `app.exit` handler. Quit is the built-in `/quit` command.
- `onSubmit(text)` handles built-in commands (`/hotkeys`, `/quit`, `/model`, …) itself. Everything else goes to the session, which runs extension commands such as `/crew-status`. Every path clears the editor with `setText("")` before its first `await`. That means restoring the draft synchronously right after calling `onSubmit` works, as DoomPi does. It also calls `addToHistory`, so leader-run commands appear in prompt history (↑). That side effect is acceptable.
- `pi.events` is a single `EventBus` (`emit(channel, data)`, `on(channel, handler) → unsubscribe`) created once in Pi's extension loader and shared by every extension. Pi loads each extension with `moduleCache: false`, so module-level state is not shared. The event bus is how extensions talk to each other.
- `pi.getCommands()` returns the registered slash commands as `SlashCommandInfo[]`, each with a `name`.
- `ctx.ui.setWidget(key, content, { placement: "belowEditor" })` draws or, with `undefined`, removes a widget below the editor. `content` can be `string[]` or a component factory `(tui, theme) => Component`.

### The extensions that will contribute bindings, and their chords

- **Crew** (`pi/extensions/crew/`):
  - **Commands:** `/crew`, `/crew-status` (opens the newest relevant crew's panel), `/crew-stop`, `/crew-resume [slug]`, and `/crew-clean`.
  - **Chord:** `index.ts` defines `PANEL_KEY = "ctrl+shift+c"`. It uses it in `pi.registerShortcut`, in the widget hint (`formatWidget(crew, \`${PANEL_KEY} or /crew\`)`), in the `closeKey` passed to `showPanel`, and in two command descriptions.
  - **Tests:** `index.test.ts` drives the panel through `f.shortcuts.get("ctrl+shift+c")` around lines 465 and 639.
  - **README:** `README.md` mentions the chord at lines 37, 88, and 96.
  - **Helpers:** `isActive()` says whether a crew is running in this session. `listCrews(commonDir)` (from `crew/state.ts`) lists every crew in the repo's ledger, newest first. `openPanel(ctx, state)` opens a given crew's panel. `commonDirOf(cwd)` finds the repo's git common directory.
- **Subagent** (`pi/extensions/subagent/`):
  - **Command:** `/subagents` opens the jobs panel.
  - **Chord:** `PANEL_KEY = "ctrl+shift+s"` in `index.ts`, used for the shortcut, the widget `hint`, `closeKey`, and the description.
  - **Mentions:** `README.md` lines 30, 52, 58, 84, and 89, and `panel.test.ts` hint fixtures.
- **Watch** (`pi/extensions/watch/`):
  - **Command:** `/watches` opens the watches and loops panel.
  - **Chord:** `PANEL_KEY = "ctrl+shift+w"`, used the same way.
  - **Mentions:** `README.md` lines 36, 50, 58, 84, and 86, and `panel.test.ts` hint fixtures.
- **Goal** (`pi/extensions/goal/index.ts`): `/goal status | pause | resume | clear`. `/goal <objective> --check <cmd>` sets a goal; it needs arguments, so the leader doesn't bind it.
- **run-panel** (`pi/extensions/run-panel/`): the shared panel. Its optional `closeKey`/`closeHint` feature stays; after this plan, no caller passes it. Leave run-panel unchanged.

### Prior art to port

DoomPi's registry, in `packages/foundations/doompi-ui/src/services/leaderRegistry/index.ts` (683 lines), and its tests, in `packages/foundations/doompi-ui/tests/components/leaderRegistry.test.ts`. Fetch them with:

```sh
B=https://raw.githubusercontent.com/AgiFlow/doompi/c3f057ab58a94667fb6f5c1e94c5a31e43bf84cf/packages/foundations/doompi-ui
curl -fsSL $B/src/services/leaderRegistry/index.ts
curl -fsSL $B/tests/components/leaderRegistry.test.ts
curl -fsSL $B/src/tui/leaderHints.ts   # the which-key panel layout
curl -fsSL $B/src/tui/doomEditor.ts    # leader routing in the editor
```

The rules to keep are restated in Milestone 1, so the port doesn't depend on reaching GitHub. Drop the Cordis hub, telemetry, `registerDeferred`, and extension-action handlers. DoomPi has no user keymap; ours is new.

## Plan of work

Each milestone leaves `node --test pi/extensions/*/*.test.ts` passing and the type check clean. Milestones 1 and 2 add pure code with no Pi dependency. After Milestone 1, Milestones 2 and 4 can run in parallel: Milestone 4 needs only `leaderContract.ts`. Milestone 3 needs Milestones 1 and 2.

Between Milestone 4 and Milestone 3 landing, a merged extension has lost its chord before the leader can reach it, but its slash command still works. Each milestone stays shippable.

### Milestone 1: the contract, the registry, and the user keymap

Goal: a pure, fully tested registry that turns contributions and the user keymap into a key tree.

Work:
- `pi/extensions/vi-mode/leaderContract.ts`. It imports nothing, because other extensions import it as `../vi-mode/leaderContract.ts`. It contains:
  - The types `LeaderTone = "default" | "exit"`; `LeaderSegment { key; label; detail?; tone? }`; `LeaderCommand { name; args? }`; `LeaderBinding { id; path: [LeaderSegment, ...LeaderSegment[]]; command: LeaderCommand }`; and `LeaderContribution { source; bindings: LeaderBinding[] }`.
  - The channel names `LEADER_CONTRIBUTE = "leader:contribute"` and `LEADER_DISCOVER = "leader:discover"`.
  - `contributeLeader(events, source, bindings)`. It emits the contribution now, answers every later `leader:discover` with the latest bindings, and returns `{ update(bindings), dispose() }`. `dispose` emits an empty list (which unregisters the source) and unsubscribes. `events` is typed structurally as `{ emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void }`.
- `pi/extensions/vi-mode/leaderRegistry.ts`, pure. It ports DoomPi's `parseContribution`, `insertBinding`, `getGroup`, and `rebuild`, keeping these rules:
  - **Parse at the boundary.** `register(value: unknown)` validates every field and returns `{ accepted, diagnostics }`. A malformed contribution is rejected whole.
    - The source must match `^[A-Za-z0-9@][A-Za-z0-9@/._:-]*$` and be at most 128 characters. The source `user` is reserved for the keymap.
    - A key must match `^[a-z0-9]$`. Lower-case it before checking.
    - A label is 1–32 characters, and a detail is at most 80. Neither may contain control characters.
    - A path has 1–4 segments.
    - Ids are non-empty and unique within the contribution.
    - Each binding has exactly one target, and it must be `command`. Contributions can't use `app`.
    - Command names have no leading `/` and no whitespace.
    - An unknown `tone` is ignored, not rejected.
  - **Last registration wins.** A source that registers again moves to the back of the order. An empty `bindings` list unregisters the source. The tree is rebuilt from every stored contribution, so when the winner unregisters, the displaced binding comes back.
  - **Takeovers are reported.** A leaf that replaces another source's leaf or group reports `c l taken over from crew`. A group that replaces a leaf reports `… to open a group`. The leader-key name is added only for display.
  - **Group labels may disagree.** The first label stays, and a diagnostic is logged.
  - **Ordering.** Options sort by key at every level. Within one contribution, bindings are inserted in id order.
  - **Core bindings.** `new LeaderRegistry(core: CoreBinding[])` takes core bindings (which may use `{ app: string }` targets) that always load first. A conflict among core bindings throws, because it's a bug.
  - **The user keymap.** `setKeymap(entries: KeymapEntry[])` stores already-parsed entries, which are applied after every contribution on each rebuild, in file order:
    - `{ keys: ["c", "l"], label: "list", command: { name: "crews" } }` binds a leaf. It always wins, and it isn't reported as a takeover. A missing intermediate group is created, labelled with its key until a keymap entry labels it.
    - `{ keys: ["c"], label: "crew" }` (no command) relabels a group, or creates an empty one. Empty groups aren't shown.
    - `{ keys: ["q", "q"], unbind: true }` removes that leaf or group. Unbinding a path that doesn't exist is reported.
    - Moving a binding is an unbind plus a bind.
  - **API.** `group(path: string[])` returns `{ label, options: { key, label, detail?, tone?, hasChildren, target? }[] }`, or `undefined` if the path is not a group. `bindings()` lists every leaf with its path, label, target, and source, for `/leader`. `diagnostics()` returns the latest conflicts. `subscribe(listener)` is called after each rebuild.
- `pi/extensions/vi-mode/leaderConfig.ts`, pure apart from one `readFileSync`. `parseLeaderConfig(value: unknown)` returns `{ config, errors }`, and `loadLeaderConfig(path)` returns the same, treating a missing file as the defaults with no errors. The format:

  ```json
  {
    "leader": "space",
    "keymap": [
      { "keys": "c", "label": "crew" },
      { "keys": "c l", "label": "list", "command": "crews" },
      { "keys": "g s", "label": "status", "command": "goal status" },
      { "keys": "q q", "unbind": true }
    ]
  }
  ```

  - `leader` is `"space"` or one printable character. It must be a key that vi NORMAL mode doesn't use at the start of a command; see "The vi-mode extension today". Export the set of NORMAL start keys from `keys.ts` (or a predicate such as `isNormalStartKey`) so the check uses the parser's own lists rather than a copy.
  - Each `keymap` entry has `keys` (space-separated, 1–4 keys, each `[a-z0-9]`, lower-cased) and exactly one of these shapes:
    - `label` plus `command` (a string, split at the first space into name and args, with no leading `/`);
    - `label` alone;
    - `unbind: true`.
  - `detail` and `tone` are optional on a binding. Unknown top-level fields and unknown entry fields are errors.
  - Errors reject the whole file. Then the defaults apply (leader `space`, empty keymap), and the errors are returned so the caller can report them. A half-applied keymap would be more confusing than none.
- Tests:
  - `pi/extensions/vi-mode/leaderRegistry.test.ts`: port the relevant DoomPi tests, covering validation and whole rejection, takeover with restore, re-register moving to the back, label disagreement, key ordering, unregistering by empty list, and the core-conflict throw. Add keymap tests: bind wins over a contribution, a relabel, an unbind of a leaf and of a group, an unbind of a missing path, and a contribution's re-registration not beating the keymap.
  - `pi/extensions/vi-mode/leaderConfig.test.ts`: cover a missing file, a valid file, each kind of error, a leader key that clashes with a vi key (`d`, `,`, `1`), and the whole-file rejection.
  - `pi/extensions/vi-mode/leaderContract.test.ts`: cover `contributeLeader` against a tiny in-memory event bus, checking announce on create, re-announce on discover, update, and dispose.

Result and proof: `node --test pi/extensions/vi-mode/*.test.ts` passes with the new tests, and the type check is clean.

### Milestone 2: the leader step and the which-key panel, both pure

Goal: given the tree, the path, and a key, decide what happens; given a group, draw the panel.

Work:
- `pi/extensions/vi-mode/leader.ts`, pure.
  - `opensLeader({ mode, pending, key, leaderKey })` returns true only when `mode === "normal"`, `pending === ""`, and `key` is the leader key.
  - `leaderKey(registry, path, key)` returns `{ type: "descend", path }`, `{ type: "run", target, path }`, or `{ type: "close", missed?: string[] }`.
    - `key` is one of: a single printable character, `"backspace"`, or `"escape"`.
    - Upper case is lower-cased before lookup.
    - `backspace` on a non-empty path goes up one level; at the root it closes.
    - `escape` closes.
    - An unknown key closes with `missed` set to the path that missed (for example `["c", "z"]`), so the editor can show it briefly.
- `pi/extensions/vi-mode/whichKey.ts`, pure. `whichKeyLines(group, path, leaderName, width, style)` returns `string[]`. It takes the layout from DoomPi's `leaderHints.ts`:
  - The column count depends only on width: 4 columns from width 130, 3 from 90, 2 from 56, otherwise 1.
  - Cells are equal width, and each option is a two-line card: a key badge plus label, then the grey detail. Details are cut with `…`, and dropped before options are when there's no room.
  - A first line shows the breadcrumb (`SPC › c / crew`) and the hint `esc cancel · backspace up`.
  - The panel is at most 21 lines, and options get space first.
  - Group options get a `+` marker, and `tone: "exit"` uses the warning colour.
  - There is no frame and no session-diagnostics rows.
  - `style` is a small injected interface (`fg(tone, text)`, `bold`, `visibleWidth`, `truncate`), so tests render plain text.
- Tests:
  - `leader.test.ts` covers every `opensLeader` case: INSERT, pending `d`, pending `f`, a non-leader key, and a custom leader key `\`. It also covers every step rule.
  - `whichKey.test.ts` checks column counts at widths 40, 60, 100, and 140, truncation, the height cap, the breadcrumb with leader names `SPC` and `\`, and the exit tone.

Result and proof: both test files pass, and the type check is clean.

### Milestone 3: LEADER mode in the editor, core bindings, config loading, and `/leader`

Goal: the leader works in Pi with vi-mode's core bindings and the user's `leader.json`.

Work:
- `pi/extensions/vi-mode/coreBindings.ts`. Core bindings, each with an `app` or `command` target:
  - `SPC m m` models › select (`app.model.select`)
  - `SPC m n` models › next (`app.model.cycleForward`)
  - `SPC m t` models › thinking (`app.thinking.cycle`)
  - `SPC s n` sessions › new (`app.session.new`)
  - `SPC s r` sessions › resume (`app.session.resume`)
  - `SPC s t` sessions › tree (`app.session.tree`)
  - `SPC s f` sessions › fork (`app.session.fork`)
  - `SPC h h` help › hotkeys (`/hotkeys`)
  - `SPC h l` help › leader map (`/leader`)
  - `SPC q q` quit (`/quit`)
- `pi/extensions/vi-mode/editor.ts`:
  - **New constructor parameter.** `ViEditor` takes a `leader` option object with: the registry; the leader key and its display name; `showPanel(lines: string[] | undefined)`; `commandExists(name)`; and `notify(text, level)`.
  - **Routing.** While the leader is open, leader routing goes ahead of the `missing` check and the paste guard. Every key goes to `leaderKey`, and nothing leaks to Pi. In particular, `Esc` never reaches Pi's abort.
  - **Opening the leader.** In `normalKey`, before the key reaches the engine, open the leader when `opensLeader(...)` is true. INSERT mode never opens it. A pasted leader key is text, because the paste guard runs first.
  - **Closing the leader.** NORMAL mode, the draft, the cursor, and the undo stack are untouched.
  - **Running a binding.** For an `app` target, call `this.actionHandlers.get(name)?.()`, and notify if it's missing. For a `command` target, first check `commandExists(name)`, or that the name is one of Pi's built-ins (`hotkeys`, `quit`), and notify if it isn't. Then save the draft, `setText("")`, call `this.onSubmit?.("/name args")`, and in a `finally`, `setText(draft)` and restore the cursor.
  - **Bottom border.** While the leader is open, the border shows the path (`SPC c`). After an unknown key, it shows the missed path for about 1.5 seconds.
  - **Panel lifecycle.** Call `showPanel(lines)` on open and on every step, and `showPanel(undefined)` on close. Re-render on registry changes while the leader is open.
- `pi/extensions/vi-mode/index.ts`:
  - **Registry.** Create one `LeaderRegistry(CORE_BINDINGS)` per extension load.
  - **Listening.** On `pi.events.on(LEADER_CONTRIBUTE, …)`, call `registry.register(data)`. On a rejected contribution, notify once with its diagnostics. New takeover diagnostics are not notified; `/leader` shows them.
  - **Discovery.** Emit `LEADER_DISCOVER` once at load, so extensions that loaded earlier announce again.
  - **Config.** On `session_start`, call `loadLeaderConfig(join(homedir(), ".pi", "agent", "leader.json"))`, then `registry.setKeymap(config.keymap)`. If there are errors, notify once with the file path and the errors.
  - **Editor wiring.** Pass the editor its leader option. `showPanel` calls `ctx.ui.setWidget("leader", lines, { placement: "belowEditor" })`. `commandExists` checks `pi.getCommands()`.
- **`/leader` command** (registered in `index.ts`). It prints:
  1. the leader key;
  2. the whole tree, one line per binding (`SPC c l  crew › list  → /crews  (crew)`), with `user` as the source of keymap entries;
  3. registry diagnostics;
  4. config errors.
- **Config file.** Add `pi/leader.json`, containing `{ "leader": "space", "keymap": [] }`, and the `link.sh` line `link pi/leader.json ~/.pi/agent/leader.json`, next to the `subagent-routes.json` line.
- `pi/extensions/test-support/fake-pi.ts`: add `events`, a working in-memory bus shared by everything using this fake (tests can pass one bus to two fakes to simulate two extensions); `getCommands()`, which returns registered commands as `{ name }`; and `onSubmit` and `actionHandlers` on the `CustomEditor` stub only if needed by tests.
- Tests in `vi-mode/index.test.ts`, with `fakePi`:
  - a contribution emitted before and after vi-mode loads both reach the tree;
  - a malformed contribution is notified;
  - a bad `leader.json` is notified and the defaults apply. Make the config path injectable for tests, for example through a factory option as crew does with `deps`.
  - `/leader` lists core, contributed, and user bindings.
- `pi/extensions/vi-mode/README.md`: a "Leader key" section covering:
  - the trigger (NORMAL mode, nothing pending);
  - the keys inside the leader;
  - the core map;
  - the `leader.json` format with an example of each entry kind;
  - `/leader`;
  - how another extension contributes, with a five-line `contributeLeader` example.

Result and proof: the tests pass and the type check is clean. Manually in Pi: in NORMAL mode, `SPC` shows the panel with groups `h m q s`; `SPC m m` opens the model selector; and after setting `"leader": "\\"` in `leader.json` and running `/reload`, `\` opens the leader and `SPC` no longer does.

### Milestone 4: contributions from crew, subagent, watch, and goal, and the chords removed

Goal: the IDEAS.md key map works, and no extension claims a `ctrl+shift` chord. This milestone needs only Milestone 1's `leaderContract.ts`. Each extension is a separate, independent change.

Work. Each extension calls `contributeLeader(pi.events, "<name>", bindings)` from `../vi-mode/leaderContract.ts` when it loads. In crew, subagent, and watch, also remove `PANEL_KEY` and its `pi.registerShortcut`, and stop passing `closeKey` to `showPanel`.
- **Crew** (`pi/extensions/crew/`):
  - Add `/crews`. With a UI, it shows `ctx.ui.select` over `listCrews(commonDir)`, labelled `slug · status · goal` (goal cut to about 60 characters), and opens the chosen crew with `openPanel`. It notifies `No crews in this repository` when there are none. Without a UI, it prints one line per crew.
  - Bindings, in group `c` "crew":
    - `l` list (`/crews`)
    - `s` status (`/crew-status`)
    - `r` resume (`/crew-resume`)
    - `c` clean (`/crew-clean`)
    - `x` stop, with tone `exit` (`/crew-stop`). Present only while `isActive()`. Call `update` wherever the crew activates or deactivates.
  - Chord removal: the widget hint becomes `/crew-status`, and the `/crew` and `/crew-status` descriptions drop the chord.
  - Tests:
    - Change `crew/index.test.ts` to open the panel through `/crew-status` (or `/crew` with no goal, as it already does elsewhere) instead of `f.shortcuts.get("ctrl+shift+c")`.
    - Add tests for `/crews` and for the contributed bindings with and without an active crew.
    - Assert that no shortcut is registered.
  - Update `README.md`: the panel opens with `SPC c s` or `/crew-status`, `q` closes it, and the kitty-keyboard note goes.
- **Subagent** (`pi/extensions/subagent/`):
  - Group `a` "agents", with `l` list (`/subagents`).
  - Remove the chord. The widget hint becomes `/subagents`.
  - Update the `panel.test.ts` hint fixtures and the `README.md` mentions.
- **Watch** (`pi/extensions/watch/`):
  - Group `w` "watches", with `l` list (`/watches`).
  - Remove the chord. The widget hint becomes `/watches`.
  - Update the `panel.test.ts` hint fixtures and the `README.md` mentions.
- **Goal** (`pi/extensions/goal/index.ts`): group `g` "goal", with `s` status, `p` pause, `r` resume, and `c` clear (`/goal status` and so on). Goal has no chord.
- **Tests.** Each extension gets a test that the contribution is emitted on load and again in answer to `leader:discover`.

Result and proof: all suites pass and the type check is clean. Both of these print nothing:

```sh
rg -n 'ctrl\+shift' pi/extensions --glob '!run-panel/**'
rg -n 'vi-mode/' pi/extensions --glob '!vi-mode/**' | rg -v 'vi-mode/leaderContract\.ts'
```

### Milestone 5: verify in Pi and tidy up

Goal: confirm the behaviour in a real terminal and record what's left.

Work, done by a person, not a crew worker:
- Run the manual checks under Validation in Ghostty and WezTerm.
- Run `./link.sh`, or link `pi/leader.json` by hand.
- Run vi-mode by hand on Pi 1.0.2, then update `CHECKED_PI_VERSION` in `bridge.ts` if it still says 0.87.1.
- In `IDEAS.md`, replace the leader entry with a pointer to this plan. Move unbuilt follow-ups there: which-key for vi operators, an idle delay, named actions, and an INSERT-mode trigger if NORMAL-only turns out to be too slow.
- Fill in Outcomes & Retrospective.

## Validation

From `~/git/dotfiles`:

```sh
node --test pi/extensions/*/*.test.ts 2>&1 | rg '^ℹ (tests|pass|fail)'
```

Success is `ℹ fail 0`, with `ℹ tests` above 333, the count before this plan.

```sh
nix shell nixpkgs#typescript -c bash pi/extensions/test-support/typecheck.sh
```

Success is exit status 0.

```sh
rg -n 'vi-mode/' pi/extensions --glob '!vi-mode/**' | rg -v 'vi-mode/leaderContract\.ts'
rg -n 'ctrl\+shift' pi/extensions --glob '!run-panel/**'
```

Success is no output from either: other extensions depend only on the contract, and no chords remain.

Manual checks in Pi, after `./link.sh` and `/reload`, in `~/git/dotfiles`:
- In INSERT mode, `SPC` types a space, on an empty prompt and on a non-empty one.
- `Esc` to NORMAL, then `SPC` opens the panel with groups `a c g h m q s w`. `Esc` closes it, leaves NORMAL mode, and doesn't abort a running turn.
- With `fix the parser` typed, in NORMAL mode, `SPC c s` opens the crew panel. After closing it, the prompt still reads `fix the parser` with the cursor where it was.
- `f SPC` still jumps to the next space, and `d SPC` doesn't open the leader.
- `SPC c` then `Backspace` returns to the root board, and `Backspace` again closes the leader.
- `SPC c z` closes the leader, and the bottom border briefly shows `SPC c z`.
- `SPC c l` lists crews and opens the one chosen.
- With a crew active, `SPC c` shows `x stop` in the warning colour. After `/crew-stop`, `x` is gone.
- `ctrl+shift+c`, `ctrl+shift+s`, and `ctrl+shift+w` do nothing.
- With `leader.json` set to `{ "leader": "\\", "keymap": [{ "keys": "o", "label": "crews", "command": "crews" }, { "keys": "q q", "unbind": true }] }`, after `/reload`:
  - `\` opens the leader, and `SPC` doesn't.
  - `\ o` runs `/crews`.
  - `q` is gone from the root board.
  - `/leader` shows `o` with source `user`.
- With `"leader": "d"`, `/reload` notifies a config error, and `SPC` still works.
- At 80 columns wide, the panel uses 2 columns and stays at or under 21 lines.

## Progress

- [x] 2026-10-23 Read IDEAS.md, the RFD, vi-mode, the four contributing extensions, Pi 1.0.2's editor wiring, and DoomPi's registry, editor, and schema; wrote this plan.
- [x] 2026-10-23 Revised the plan after review: NORMAL-only trigger, no `ctrl+space`, chords removed, configurable leader key and keymap.
- [x] 2026-10-23 Milestone 1: `leaderContract.ts`, `leaderRegistry.ts` (with keymap), `leaderConfig.ts`, and their tests. `keys.ts` exports `isNormalStartKey`, tested against the parser itself.
- [ ] Milestone 2: `leader.ts`, `whichKey.ts`, and their tests.
- [ ] Milestone 3: LEADER mode in `editor.ts`, core bindings, config loading, `/leader`, `pi/leader.json` with its `link.sh` line, the fake-pi events, and the README.
- [ ] Milestone 4a: crew bindings, `/crews`, and the crew chord removed.
- [ ] Milestone 4b: subagent bindings and the subagent chord removed.
- [x] 2026-10-23 Milestone 4c: watch bindings and the watch chord removed.
- [ ] Milestone 4d: goal bindings.
- [ ] Milestone 5: manual checks, the bridge version, IDEAS.md, and the retrospective.

## Surprises & Discoveries

- 2026-10-23: Pi has no `app.exit` action handler; quit is the built-in `/quit`, so `SPC q q` submits `/quit`. Evidence: `rg -o 'onAction\("app\.[a-zA-Z.]+"' dist/modes/interactive/interactive-mode.js` lists no `app.exit`.
- 2026-10-23: Pi copies `actionHandlers`, `onSubmit`, and `onCtrlD` into a custom editor after its factory returns, so the editor must look them up at run time.
- 2026-10-23: Leader-run commands go through `onSubmit`, which calls `addToHistory`, so they show up in prompt history.
- 2026-10-23 (M1): DoomPi keeps the first registrant's label even when a leaf is taken over, so the row says one thing and runs another. Ours doesn't; see the Decision Log.
- 2026-10-23: `typecheck.sh` needs a `tsc`. Pi 1.0.2 bundles none and none is on PATH; `nix shell nixpkgs#typescript -c …` works (TypeScript 7.0.2, about 5 seconds).

## Decision Log

- 2026-10-23: The leader goes inside vi-mode as a transient third mode (the RFD's option A). Pi has one editor slot, and vi-mode owns it. Rejected: a shared editor-layer extension (B), a framework for two users; installing DoomPi's UI package (C), which would replace vi-mode; and a chord-opened overlay (D).
- 2026-10-23 (user): The leader opens only in NORMAL mode with no command pending. Space in INSERT mode always types a space. This overrides the RFD's empty-prompt INSERT trigger: there's no surprise when typing, and NORMAL's space is unused today.
- 2026-10-23 (user): No `ctrl+space`. It collides with macOS input switching and tmux prefixes, and NORMAL mode is one `Esc` away.
- 2026-10-23 (user): Remove the `ctrl+shift+c/s/w` chords instead of keeping them as aliases (RFD open question 3). The leader and the slash commands cover them. run-panel's `closeKey` option stays, unused, because removing it isn't needed.
- 2026-10-23 (user): The leader key and the key map are configurable in `~/.pi/agent/leader.json` (RFD open question 4). The keymap is a last layer that always wins and can unbind. Moving a binding is unbind plus bind, so no binding ids are exposed to users. A bad file is rejected whole, and the defaults apply.
- 2026-10-23: The leader key must be a key vi NORMAL leaves unused at the start of a command, checked against `keys.ts`'s own lists, so the leader can never shadow a vi command.
- 2026-10-23: Contributions are commands only in v1. Named actions would need a return channel to the owning extension; add them when a binding can't be written as a slash command. vi-mode's own core bindings may use Pi app actions.
- 2026-10-23: The contract lives in `pi/extensions/vi-mode/leaderContract.ts` and imports nothing. A new shared directory would need its own `link.sh` line, as `run-panel` did (commit `6742be0`). Other extensions import only this file from vi-mode.
- 2026-10-23: The panel shows at once, with no idle delay. That's simplest, and it matches DoomPi. Revisit after use (RFD open question 2).
- 2026-10-23: Conflict diagnostics and config errors show in `/leader`. A notification fires only for a rejected contribution or a rejected `leader.json` (RFD open question 5).
- 2026-10-23: Out of scope: which-key for vi operators, named actions, and DoomPi's mode badges and session-diagnostics rows (RFD open question 1).
- 2026-10-23 (M1): API shapes for Milestones 2 and 3. `LeaderTarget = { command: LeaderCommand } | { app: string }`. `CoreBinding = { id, path, target }`, and core leaves report source `core`. `KeymapEntry` is `{ keys, label, detail?, tone?, command? }` or `{ keys, unbind: true }`. `LeaderConfig.leader` is parsed to `{ key, name }` (`{ key: " ", name: "SPC" }` by default), so callers never re-interpret `"space"`. `group()` options carry `target`; `bindings()` returns `{ keys, labels, detail?, tone?, target, source }`. `register()` returns only the registering source's diagnostics (its takeovers); `diagnostics()` returns all.
- 2026-10-23 (M1): A leaf that takes over a key shows the newcomer's label, detail, and tone, and a leaf turned into a group takes the new group's label. Only shared groups keep the first label. A row that reads "list" but runs someone else's command would mislead.
- 2026-10-23 (M1): A label-only keymap entry relabels whatever is at its keys, a leaf included (renaming `c l` keeps its command), and creates an empty group only when nothing is there. `detail` and `tone` are allowed on label-only entries as well as on bindings. A keymap bind through an existing leaf turns it into a group silently, labelled with its key.
- 2026-10-23 (M1): Binding ids need only be non-empty, at most 128 characters, and free of control characters, as the plan says; DoomPi's stricter id pattern isn't ported. Command args may not contain control characters.
- 2026-10-23 (M1 review): A label-only keymap entry never destroys a leaf. If a key before its last crosses a leaf, the entry is skipped, nothing is created, and `/leader` shows a `user` diagnostic. A keymap entry with a command still replaces any leaf on its path.
- 2026-10-23 (M1 review): `register()` checks every string exactly as sent. Lower-casing the key is its only normalisation. Labels, details, and ids with leading or trailing whitespace are rejected, and command args are stored verbatim. Contributions are code, and trimming first let `" c "` or `"crews\n"` through. A source with control characters is rejected explicitly. JS `$` without the `m` flag already refused `"crew\n"`, but the regex shouldn't be the only guard. `leader.json` is typed by hand, so it still trims spaces, but it checks the raw keys, label, detail, and command for control characters first.
- 2026-10-23: `SPC c l` runs a new `/crews` picker built on `ctx.ui.select`, not the full multicrew panel from IDEAS.md. It's the smallest thing that lists crews.

## Outcomes & Retrospective

(Fill in at the end.)

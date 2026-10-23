# run-panel

The shared panel behind `/crew-status`, `/subagents`, and `/watches`. Each extension
describes its work as a **source**: a list of items, how to show each one, and what can
be done to it. The **presenter** here draws any source the same way: header, list,
tabbed details, footer, filter, scrolling, zoom, help, and confirmations. It knows
nothing about crews, subagents, or watches.

This is not an extension. It has no `index.ts` and no line in `link.sh`, so Pi never
loads it. Extensions import it by relative path (`../run-panel/pi.ts`); Pi resolves
imports from a symlinked extension's real path, so that works. Nothing here imports
from an extension.

| File | What |
|---|---|
| `source.ts` | The `Source` interface and `Content` kinds |
| `state.ts`, `input.ts` | Interaction state and key handling; synchronous, no Pi |
| `render.ts` | Layout, columns, content, help, footer; no Pi |
| `pi.ts` | Raw keys to panel input, `makeStyle(theme)`, and `openPanel` |
| `format.ts`, `markdown.ts` | Shared helpers (`duration`, `money`, `box`, …) and the glow renderer |
| `fixture.ts` | A small crew-shaped source and a plain-text `Style` for tests |

## Sources

```ts
const handle = openPanel(ctx, mySource, { id: "jobs", closeKey: "ctrl+shift+j" });
```

A source provides:

| Field | Default | What |
|---|---|---|
| `name` | required | List title, e.g. `Tasks` |
| `items()` | required | Items in display order; called on every render, so keep it cheap |
| `columns` | required | Declared once: `id`, `width`, `fill` (a weight), `align`, `drop` |
| `views` | required, at least one | The details tabs |
| `actions` | required (may be empty) | Named actions; help and footer hints come from them |
| `header()` | none | Lines above the panes, as segments (text, tone, bold, or a bar) |
| `status(matched, total)` | `matched/total`, or `total` unfiltered | Beside the list title |
| `busy()` | not busy | Shows a spinner beside the list title |
| `empty` | `Nothing yet` | Text in an empty list |
| `subscribe(onChange)` | re-render on the tick only | Re-render when data changes; returns an unsubscribe |
| `dispose()` | none | The panel closed: stop timers, drop caches |

Each **item** carries its record (`value`), handed back to views and actions, and
separately what the filter matches (`text`, a string or several fields; a filter token
must match within one field). It also has `cells` (one per column id), an optional
`glyph` (unset: an animated spinner), `running` (running items are picked first when the
panel opens), a `title`, and an optional `defaultView`, which the panel follows until the
user picks a tab.

**Columns** with a higher `drop` disappear first as the list narrows.

A **view** is `{ id, label, render(value, ctx), tail? }`. `render` is synchronous and
returns `Content`: `loading`, `message`, `fields`, `markdown`, `lines` (optionally
wrapped, or painted as a diff), `bullets`, `collapsible` (a cursor; `enter` opens or
closes an entry), `transcript`, or `sections` of these. A view that loads in the
background returns `{ kind: "loading" }` and calls `ctx.changed()` when the data is
ready. With `tail`, the view opens at the end and follows new lines until the user
scrolls up.

An **action** is `{ id, label, key, description?, available?, confirm?, run }`:
- `available(value)` returns `true` or the reason it isn't, shown as a flash. It's
  checked again when the user answers `y`.
- `confirm(value)` returns a question; the action runs only after `y`.
- `run(value, ctx)` returns nothing, `"close"`, or `{ flash, tone }`, or a promise of
  one. `ctx.flash()` shows progress. A result that arrives after a later key press goes
  to a notification instead of the footer.

Keys the presenter owns, which an action can't use (`checkSource` throws, so tests
catch it): `j k g G l h q ? /`, space, and the digits. Tab, arrows, `ctrl+d`/`ctrl+u`,
`ctrl+o`, `enter`, and `esc` aren't printable, so they're never action keys.

`openPanel(ctx, source, opts)` returns `{ close(), closed }` straight away, or
`undefined` without a UI or when a panel with the same id is already open. Options:

| Option | Default | What |
|---|---|---|
| `id` | `source.name` | Guards against opening the same panel twice |
| `closeKey` | none | The shortcut that opened the panel; it closes it too |
| `tickMs` | 500 | Refresh interval |
| `spinnerMs` | `tickMs` | Faster interval while a spinner shows (busy, or an item with no glyph) |
| `overlay` | centred, 95% wide, 85% high | Pi overlay options |
| `style(theme)` | `makeStyle(theme)` | The `Style`; `makeStyle` always supplies `markdown` |

## Example

[`fixture.ts`](fixture.ts) is the source the presenter's tests use: crew-like jobs with a
header, six columns, five views, and three actions. Trimmed:

```ts
export function fixtureSource(jobs: Job[]): Source<Job> {
  return {
    name: "Tasks",
    empty: "No tasks yet",
    items: () => jobs.map((j) => ({
      id: String(j.id),
      value: j,
      text: [`#${j.id}`, j.status, j.kind, j.title, j.branch],
      cells: { id: { text: `#${j.id}`, tone: "accent" }, title: j.title, cost: money(j.cost) },
      glyph: j.status === "running" ? undefined : { text: j.status === "done" ? "✓" : "✗", tone: "success" },
      running: j.status === "running",
      title: `#${j.id} ${j.title}`,
    })),
    columns: [{ id: "id" }, { id: "title", fill: true }, { id: "cost", width: 5, align: "right", drop: 1 }],
    views: [
      { id: "spec", label: "Spec", render: (j) => ({ kind: "lines", lines: j.spec.split("\n"), wrap: true }) },
      { id: "live", label: "Live", tail: true, render: (j) => ({ kind: "transcript", note: "streaming", dropped: 0, entries: j.entries }) },
    ],
    actions: [{
      id: "cancel", label: "cancel", key: "x",
      available: (j) => (j.status === "running" ? true : `#${j.id} is not running`),
      confirm: (j) => `Cancel #${j.id}?`,
      run: (j) => ({ flash: `Cancelling #${j.id}`, tone: "warning" }),
    }],
  };
}
```

The real sources are [`crew/source.ts`](../crew/source.ts),
[`subagent/source.ts`](../subagent/source.ts), and [`watch/source.ts`](../watch/source.ts).

## Prior art

The split into data and a generic UI follows two Neovim pickers:

- **[telescope.nvim](https://github.com/nvim-telescope/telescope.nvim)**: the entry
  maker's `value` and `ordinal` (the record kept beside its display, with separate match
  text), `entry_display` (columns declared once), previewers with teardown (views and
  `dispose`), and named actions with default keys.
- **[mini.pick](https://github.com/echasnovski/mini.nvim)**: one source table where every
  field but the items has a default, help generated from the active mappings, actions that
  say whether to close, a busy state, and the `matched/total` status.

Left for later, in [`IDEAS.md`](../../../IDEAS.md): marking several items, refine, query
syntax, user key maps, resume, the widgets, and one `/runs` panel across extensions.

## Checks

```sh
node --test pi/extensions/run-panel/*.test.ts
rg -n 'from "\.\./(crew|subagent|watch)/' pi/extensions/run-panel   # no output
node pi/extensions/test-support/mutate.ts run-panel
```

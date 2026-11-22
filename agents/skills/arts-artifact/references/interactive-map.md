# Building an interactive map

An interactive map is the right artifact when the subject is a **system, a
decision surface, or a set of things and how they relate** — data flows,
options and their trade-offs, a phased plan with dependencies, an architecture
with status. If the relationships are the point, build a map; if a linear
narrative is the point, build a document (authoring.md) with an inline `.cgmap`.

The worked reference is **`references/container_telemetry_map.html`** —
a decision surface for a telemetry initiative. Read it in full, then adapt it:
keep its rendering + interaction engine, replace its data, and restyle its
neutrals to the arts palette. Don't rebuild the interaction from scratch — the
edge-routing and panel-positioning are fiddly and already correct.

## Anatomy

The whole map is data-driven: a few inline `const` arrays feed a builder that
creates positioned DOM nodes, an SVG edge layer, and the interactions.

- **`NODES`** — the boxes. Each: `id`, `st` (status key), `x`/`y`/`w`/`h`
  (absolute px on the canvas), `t` (title), `s` (one-line subtitle, may contain
  `<b>`), `d` (full detail HTML for the panel), optional `tag` (corner pill),
  optional `more` (shows a "click ›" affordance).
- **`EDGES`** — directed links `[fromId, toId, dashed]` (`dashed` 1 = planned /
  soft, 0 = solid). Rendered as arrowed bezier curves anchored to the nearest
  node edges; the panel derives "Feeds from / Feeds into" from them.
- **`HEADS`** — column/section headers: `{x, y, t}`. Use them to lay the map out
  in columns (source → decision → detail → output) so coordinates stay legible.
- **`GROUPS`** — dashed containers drawn behind a set of `members` (node ids)
  with a label; for "these belong together" (a subsystem, a storage tier).
- Optional **`BAND` + `DECS`** — a highlighted footer band of key
  decisions/notes, as in the example. Drop it if the map doesn't need it.

## Status color system

The map's language is its status legend — a small fixed set of statuses, each a
colored border + wash + legend chip that filters. Define the set the subject
needs (the example uses implemented / partial / planned / blocked / context).
Keep these **semantic** hues distinct and consistent:

```
--imp:#16a34a; --imp-bg:#eafaf0;   /* done / healthy (green)  */
--par:#d97706; --par-bg:#fef6e7;   /* partial / staging (amber) */
--pln:#2563eb; --pln-bg:#eef3fe;   /* planned / proposed (blue) */
--blk:#dc2626; --blk-bg:#fdeeee;   /* blocked / broken (red)  */
--ctx:#64748b; --ctx-bg:#f1f5f9;   /* context / gate (slate)  */
```

Rename/trim them to fit the domain, but don't overload the Chainguard blurple
accent as a status — reserve blurple for focus/pin.

## Restyle the neutrals to arts

The example ships with `Poppins` and slate neutrals. For it to blend into arts,
change only the chrome, not the status hues:

- font-family → `system-ui,-apple-system,"Segoe UI",sans-serif` (drop Poppins).
- `--paper:#ffffff` (card), `--wash:#ffffff` or a hair of `#f8f6fe` (page),
  `--ink:#0d161c`, `--sub:rgba(13,22,28,.8)`, `--mut:rgba(13,22,28,.55)`,
  `--line:#ededed`.
- Add a dark theme with a `:root[data-theme="dark"]` block using the arts dark
  tokens (see arts-principles.md) and a `◐` toggle, if the map should match the
  gallery's dark mode. Optional but preferred.
- Keep the pin/focus ring in the blurple accent.

## Interaction (keep as-is)

Copy these behaviours from the example verbatim; they are the point of an
interactive map:

- **Hover a node → focus**: spotlight it and its neighbours (via the adjacency
  built from `EDGES`), dim everything else and non-incident edges.
- **Click a node → pin + panel**: a detail panel opens next to the node
  (clamped to the viewport), showing the title, a status badge, the `d` detail,
  and Feeds-from / Feeds-into derived from `EDGES`. Click it again, the close
  affordance, or empty space to unpin.
- **Legend chips → filter by status**; **Reset** clears filter + pin.
- **`fit()`** scales the fixed-size `#canvas` to the viewport width on load and
  resize, so the hand-placed coordinates work on any screen.

## Steps

1. Model the domain into `NODES` (with statuses), `EDGES`, `HEADS`, `GROUPS`, and
   an optional `BAND`/`DECS`. Write real, specific `d` detail per node — the
   panel is where the artifact earns its value.
2. Lay out coordinates in columns under the `HEADS`; give related nodes a
   `GROUP`. Size the canvas (`#canvas` width/height) to contain everything.
3. Start from the example's CSS + builder + interaction JS; swap in your data and
   status set; restyle neutrals to arts (above).
4. Set `<title>` and add `<meta name="author">`, `<meta name="description">`, and
   `<meta name="date">` in the head (build_artifact.py doesn't run for maps, so
   add them by hand — arts catalogs by them; see arts-principles.md).
5. Write the file into the folder/bucket arts watches; print its path to the
   user. Verify it opens standalone (no console errors) and that hover/click/
   filter/reset all work.

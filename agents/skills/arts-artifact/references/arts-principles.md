# arts principles

Every artifact this skill builds is a **single self-contained HTML file** that
drops into the arts library (env/chaindag.dev/cmd/arts) — a gallery that lists
HTML artifacts and renders each inline in an iframe. Follow these so the artifact
is cataloged correctly and blends into the gallery.

## Self-contained, always

- One `.html` file. No external CSS/JS/font/image URLs, no build step, no network
  fetches. Inline all styles and scripts; embed data as inline `<script>` consts;
  embed images as data URIs only if essential.
- It must open correctly from `file://` and inside the arts iframe with no server.
- Plain vanilla JS. No frameworks, no CDNs.

## Metadata arts reads from the `<head>`

arts derives each catalog entry from the document head, with fallbacks. Emit
these so the entry is accurate rather than defaulted:

| Field in arts | Head source | Fallback if absent |
| --- | --- | --- |
| Author | `<meta name="author">` | the literal `Clauded` |
| Description (fuzzy search) | `<meta name="description">` | — |
| Title | `<title>` | prettified file name |
| Date | `<meta name="date">` | file / object modified time |

`build_artifact.py` writes these for you (`--author`, `--description`, `--date`;
description defaults to the lede). If you hand-author a file (e.g. an interactive
map), add the three `<meta>` tags and a `<title>` yourself. Keep the description
to one plain sentence — arts weights it in fuzzy search.

## Palette (light + dark)

Use these CSS variables; the document shell already declares them, and they
mirror arts's own tokens so the artifact blends in the viewer. Support both
themes with `:root[data-theme="dark"]`.

Light:

```
--bg:#ffffff; --card:#ffffff; --ink:#0d161c;
--ink2:rgba(13,22,28,.8); --muted:rgba(13,22,28,.55);
--line:#ededed; --accent:#6226fb; --accent-wash:#f1ecfe;
```

Dark:

```
--bg:#0b0e14; --card:#141922; --ink:#eef1f4;
--ink2:rgba(238,241,244,.74); --muted:rgba(238,241,244,.45);
--line:#26303f; --accent:#a288ff; --accent-wash:#221d3a;
```

The blurple accent `#6226fb` (light) / `#a288ff` (dark) is Chainguard's — use it
for links, focused/pinned states, and callout accents, never for large fills.
Keep semantic status colors (green = good/done, amber = partial, red =
blocked/error) distinct from the accent; an interactive map defines its own
status palette (see interactive-map.md).

## Fonts

arts uses **Gellix** and **Roobert SemiMono** from its own `@font-face` rules,
which a standalone artifact can't rely on. Stay on `system-ui` (and a monospace
stack for code); it sits cleanly next to Gellix in the viewer. Do not pull a web
font from a CDN — that breaks the self-contained rule.

## Choosing the artifact shape

- **Document shape** — a report (no quiz), briefing, one-pager, memo, or a page
  whose centrepiece is an inline `.cgmap` flow diagram: author a content fragment
  and wrap it with `build_artifact.py`. See authoring.md.
- **Canvas shape** — an interactive decision/relationship map, or a full-bleed
  dashboard of positioned tiles: hand-author the whole file in the arts palette,
  adapting references/container_telemetry_map.html. See
  interactive-map.md. Do not force a canvas artifact through the document shell.

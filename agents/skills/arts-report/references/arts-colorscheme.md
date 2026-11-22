# Blending into the arts library

`arts` (env/chaindag.dev/cmd/arts) is a gallery that lists HTML artifacts from a
folder or GCS bucket and renders each one inline in an iframe. A report built by
this skill is a self-contained artifact, so it should (a) expose the metadata
arts catalogs by and (b) share arts's palette so it blends in the viewer.

## Metadata arts reads from the `<head>`

arts derives each artifact's catalog entry from the document head, with
fallbacks. Emit these so the entry is accurate rather than defaulted:

| Field in arts | Head source | Fallback if absent |
| --- | --- | --- |
| Author | `<meta name="author">` | the literal `Clauded` |
| Description (fuzzy search) | `<meta name="description">` | — |
| Title | `<title>` | prettified file name |
| Date | `<meta name="date">` | file / object modified time |

`build_report.py` writes the author and description tags for you — pass
`--author` and `--description` (the description defaults to `--lede`). Keep the
description to one plain sentence; arts weights it in fuzzy search behind title
and tags.

## Palette (kept in sync with `report-template.html`)

The report template already uses these values, so a generated report blends
without extra work. They mirror arts's own CSS variables.

Light:

```
--bg:#ffffff; --surface:#ffffff; --ink:#0d161c;
--ink2:rgba(13,22,28,.8); --muted:rgba(13,22,28,.55);
--line:#ededed; --accent:#6226fb; --accent-dark:#3200af; --accent-wash:#f1ecfe;
```

Dark (`:root[data-theme="dark"]`):

```
--bg:#0b0e14; --surface:#141922; --ink:#eef1f4;
--ink2:rgba(238,241,244,.74); --muted:rgba(238,241,244,.45);
--line:#26303f; --accent:#a288ff; --accent-dark:#c3b2ff; --accent-wash:#221d3a;
```

The blurple accent `#6226fb` (light) / `#a288ff` (dark) is Chainguard's; use it
for links, the quiz's primary button, and callout accents — never for large
fills.

## Fonts

arts uses **Gellix** (display/body) and **Roobert SemiMono** (mono/labels),
loaded from its own `@font-face` rules. A standalone report can't rely on those
web fonts, so the template stays on `system-ui`, which sits cleanly next to
Gellix in the viewer. Do not hard-code a font that fights arts's — if you style
inline, prefer `system-ui` for prose and a monospace stack for code.

---
name: arts-artifact
description: Build a self-contained, arts-styled interactive HTML artifact from a prompt — a report (no quiz), briefing, one-pager, explainer with a diagram, or an interactive decision/relationship map — inferring the kind from the request. Use when asked to "build/make an artifact", "an arts artifact", "an interactive map", "a decision map", "a relationship diagram", "a system map", or a standalone HTML page in the arts style, or to visualize a system, decision, or plan as a shareable HTML file for the arts library. For an explainer that ends in a graded quiz, use the arts-report skill instead.
---

# arts artifact

Produce one self-contained HTML file — an artifact in the arts style — that
drops into the arts library and renders inline there. You supply the substance
(and, for a map, the layout); the skill supplies the arts look and the working
interactions. No quiz (that's the separate arts-report skill).

## When to use

Use when the user wants a standalone HTML artifact built in the arts style: a
report or briefing, a one-pager, an explainer, a diagram, or an interactive map
of a system/decision/plan. Infer the artifact **kind** from the prompt — the
user describes the subject and shape ("a map of…", "a one-pager on…", "an
explainer that…"); pick the shape that fits. If the shape is genuinely unclear,
ask one question; otherwise choose and proceed.

Do not use for: a report that must end in a graded quiz (use arts-report), or a
change to an existing non-arts page.

## Pick the shape

Two shapes, described in `references/arts-principles.md`:

- **Document shape** — report/briefing/one-pager/memo, or an explainer whose
  centrepiece is an inline `.cgmap` flow diagram. Author a content fragment and
  wrap it with the build script.
- **Canvas shape** — an interactive decision/relationship/system map (positioned
  nodes, arrowed edges, a detail panel, a status legend), or a full-bleed
  dashboard. Hand-author the whole file from the worked example.

When in doubt: if the *relationships between things* are the point, build a map;
if a *narrative* is the point, build a document.

## Workflow — document shape

1. **Understand the subject.** Read the relevant code / docs / conversation.
   Don't write from assumptions.
2. **Write the content fragment** (HTML, no wrapper) following
   `references/authoring.md`: the arts CSS classes, tables over long lists,
   depth on subtle mechanisms, and an inline `.cgmap` diagram when a flow or
   relationship is worth showing.
3. **Build.** Wrap it with the script, which stamps the arts shell + head meta:
   ```bash
   python3 scripts/build_artifact.py --title "..." --lede "..." \
     --author "..." --description "..." --date YYYY-MM-DD \
     --content /tmp/artifact-body.html
   ```
4. **Print only the path.** Don't paste the HTML.

## Workflow — interactive map

Follow `references/interactive-map.md`, adapting the worked example
`references/container_telemetry_map.html`:

1. **Model the domain** into the map's data arrays (`NODES` with statuses,
   `EDGES`, `HEADS`, `GROUPS`, optional decision `BAND`). Write real, specific
   per-node detail — the detail panel is where a map earns its value.
2. **Lay out** coordinates in columns under the section heads; group related
   nodes; size the canvas to contain them.
3. **Reuse the example's engine** (rendering, edge-routing, hover-focus,
   click-to-pin panel, legend filter, reset, fit-to-width) verbatim; swap in your
   data and status set.
4. **Restyle neutrals to arts** and keep the semantic status colors; add the
   head `<title>` + `<meta name="author">`/`description`/`date` by hand.
5. **Write the file** and print its path; verify it opens standalone with no
   console errors and that hover / click / filter / reset all work.

## Rules

- Always one **self-contained** HTML file: inline CSS/JS, no CDNs, no external
  fonts or network fetches; it must open from `file://` and inside the arts
  iframe. See `references/arts-principles.md`.
- Always emit the head metadata arts catalogs by (`<title>`, author,
  description, date). The build script does this for documents; add it by hand
  for maps.
- Match the arts palette and support light + dark. Reserve the blurple accent for
  links and focus/pin, never as a status color.
- No quiz. Never fabricate data to fill a map or a table — if a fact is unknown,
  mark it as unknown (a "blocked / unanswered" status exists for exactly this).
- Write artifacts to the OS temp dir (or the folder/bucket arts watches); never
  into the repo.

## Files

- `scripts/build_artifact.py` — wraps a content fragment in the arts document
  shell with head meta; writes the file and prints its path.
- `assets/artifact-template.html` — the arts document shell: palette (light/dark),
  theme toggle, title/lede/head-meta placeholders, and the inline `.cgmap`
  diagram engine.
- `references/arts-principles.md` — self-contained rule, head metadata, palette,
  fonts, and how to choose the artifact shape.
- `references/authoring.md` — the content fragment: structure, CSS classes, and
  the inline interactive diagram.
- `references/interactive-map.md` — how to build an interactive map from the
  worked example.
- `references/container_telemetry_map.html` — a complete interactive map
  to read and adapt.

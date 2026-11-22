# Authoring a document-shape artifact

The one input `build_artifact.py` needs: the content fragment. The shell (arts
palette, theme toggle, `<h1>` title, lede, head meta, and the inline-diagram
engine) is added around it.

## Content fragment

An HTML fragment — no `<html>`/`<head>`/`<body>` wrapper, no `<style>`/`<script>`,
no `<h1>` (the title is the page `<h1>`). Use `<h2>` for top sections (they get a
divider rule) and `<h3>` for sub-sections. Lead with intuition, then detail;
prefer short paragraphs; put code identifiers in `<code>`.

Shape the fragment to the artifact the prompt asks for — there is no fixed
section list. Common shapes:

- **Report / briefing** — a TL;DR `callout`, then context, the point, the detail
  (a `<table>` reads better than a long list for anything comparative), and
  what's next. Include risks/rollback only if the subject has them.
- **One-pager** — a lede, one or two `card`s or a `stats` row, a short table.
- **Explainer with a diagram** — prose plus one interactive `.cgmap` diagram
  (below) when the subject is a flow, cascade, or how components relate.

Go deep where a mechanism is subtle (a threshold, timeout, fallback, ordering
rule) — those are what a reader misreads — and put the counter-intuitive point in
a `callout`. Keep the rest skimmable.

## CSS classes (styled by the shell)

- `<div class="callout"><div class="k">Intuition</div><p>…</p></div>` — a
  highlighted aside. Add class `warn` for a caution.
- `<span class="tag">label</span>` — a small accent pill.
- `<div class="card">…</div>` — a plain bordered panel.
- `<div class="stats"><div class="stat"><div class="n">42</div><div class="l">label</div></div>…</div>`
  — a KPI tile row for briefings/dashboards.
- `<table>…</table>` — standard; good for comparisons and change lists.
- Flow / cascade diagram (static): `.diagram` › `.box` › `.node` (variants
  `node ok` green, `node err` red) joined by `.arrow` connectors.

## Interactive diagram (`.cgmap`)

For a flow, cascade, or small relationship set inside a document, wrap it in
`<div class="cgmap">`. Tag each focusable element `data-node="id"` and declare
relations with `data-rel="otherid …"` and/or edges. Hovering a node spotlights it
and everything related and dims the rest; clicking pins it. The shell supplies
this behaviour — you author only the markup and ids.

Make it informative, not a box list: **label every transition** (put the
condition/timing in the `.arrow` — `▼ on config change`, `▼ +15m: cache expires`,
`▼ if unreachable`, never a bare `▼`) and **show the branch/failure path**, not
just the happy line (mark the failure `node err`, the recovered state `node ok`).
Drop the diagram if it only restates a linear A → B → C — that belongs in a
sentence.

```html
<div class="cgmap">
  <div class="diagram"><div class="box"><h4>Config goes stale</h4>
    <div class="node ok" data-node="write" data-rel="poll">Operator writes flag to GCS</div>
    <div class="arrow">▼ steady state: server polls every 30s</div>
    <div class="node" data-node="poll" data-rel="write serve">Server refreshes its cache</div>
    <div class="arrow">▼ +15m since last success: max-age trips</div>
    <div class="node err" data-node="serve" data-rel="poll">Server refuses to serve stale flags</div>
  </div></div>
</div>
```

A full-page interactive **map** (positioned nodes, arrowed edges, a detail panel,
a status legend) is a different, richer artifact — build it from
interactive-map.md, not from this fragment shell.

## Build

```bash
python3 scripts/build_artifact.py \
  --title "What the artifact is" \
  --lede "One-line summary shown under the title." \
  --author "Author Name" \
  --description "One plain sentence describing the artifact." \
  --date 2026-07-29 \
  --content /tmp/artifact-body.html
```

`--description` defaults to the lede. Optional: `--slug my-topic` (else derived
from the title), `--out-dir` (default `/tmp`). It prints the output path — print
only that path to the user; don't paste the HTML. To publish, drop the file in
the folder or bucket arts watches.

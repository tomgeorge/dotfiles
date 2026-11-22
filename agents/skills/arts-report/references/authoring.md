# Authoring a quiz report

How to write the two inputs the build script needs: the content fragment and the questions JSON.

## Content fragment

An HTML fragment (no `<html>`, `<head>`, `<body>`, `<style>`, or `<script>`; no quiz). The template wraps it and appends the quiz. Structure it for progressive understanding, roughly:

1. A TL;DR callout up top.
2. Context: how the thing works today / the setup, in plain language.
3. The problem or the goal: what broke, or what is being changed and why.
4. Options and the decision, when there was one (a table works well).
5. What was built: the concrete changes, **always as a `<table>`** — one row per change, never a bulleted list here, so this section is consistent and scannable across every report. Use columns like `Change` / `Where` / `What it does` (adapt the headers to the work, but keep it a table). A `<span class="tag">` in the first cell reads well as the change type.
6. Risks: what could go wrong because of the change. If there are genuinely none, say so in a line rather than dropping the section silently.
7. Rollback: how to undo it. If it reverts cleanly, say so briefly. If rollback is tricky or effectively one-way — data migrations, live cutovers, deletions, changes to external state — say that plainly, explain what makes it hard, and give the safest recovery. Use a `callout warn` when rollback is not clean.
8. Facts worth keeping: the handful of things the reader should retain (these usually map to quiz questions).

Lead each section with intuition, then detail. Prefer short paragraphs. Put code identifiers in `<code>`.

### Go deep where it is subtle

A one-line mention of a subtle mechanism — a threshold, timeout, max-age, fallback, retry, ordering rule, default — is not enough; those are exactly the parts a reader misreads. For each one that matters, unpack it: what the value is measured from (not what it is casually assumed to be), when it does and does not trigger, what it protects against, a concrete failure scenario, its default, and how it composes with related mechanisms. Match the depth of a careful verbal walk-through, and put the counter-intuitive point in a `callout`. Spend the words where a misunderstanding is costly; keep the rest skimmable rather than padding every line.

### CSS classes available (styled by the template)

- `<div class="callout"><div class="k">Intuition</div><p>…</p></div>` — a highlighted aside. Add class `warn` for a caution (`<div class="callout warn">`).
- `<span class="tag">label</span>` — a small pill, e.g. to tag a change type.
- `<div class="card">…</div>` — a plain bordered panel.
- `<table>…</table>` — standard; good for options/comparisons and change lists.
- Before/after or flow diagrams:
  ```html
  <div class="diagram">
    <div class="box"><h4>Before</h4>
      <div class="node">a step</div>
      <div class="arrow">▼</div>
      <div class="node err">the failure</div>
    </div>
    <div class="box"><h4>After</h4>
      <div class="node ok">the fix</div>
    </div>
  </div>
  ```
  `node` variants: plain, `node ok` (green), `node err` (red). `arrow` for connectors.
- Use `<h2>` for top sections (they get a divider) and `<h3>` for sub-sections. Do not add an `<h1>` (the title is the page `<h1>`). Do not add a "Quiz" heading (the template adds it).

## Interactive diagrams (when they help)

Add a diagram only when the change is about structure, event flow, or how components relate — an architecture, a request or failure path, a service graph, a timed cascade. Skip it for simple, local changes where a diagram adds nothing.

Wrap the diagram in `<div class="cgmap">`. Tag each focusable element with `data-node="id"` and declare its relationships with `data-rel="otherid …"` (space-separated) and/or edges. Hovering a node then spotlights it and everything related and dims the rest; clicking pins it. The template supplies this behaviour — you only author the markup and the ids. Relations are reciprocal (if A lists B, hovering B also lights A).

### Make it informative, not a box list

A diagram earns its place only if it says something the prose does not. A vertical stack of unlabeled boxes joined by bare `▼` arrows just re-lists the components; it teaches nothing. Before shipping one, make it carry information:

- **Label every transition.** The text in each `.arrow` states what flows, the condition that triggers it, or the time it takes — not a naked arrow. Write `▼ on config change` or `▼ +15m: cache expires` or `▼ if unreachable`, never just `▼`.
- **Show the branch or failure path**, not only the happy line. The interesting part of most changes is what happens when something is stale, missing, unreachable, or exceeds a threshold. Draw that path and mark its terminal `node err`; mark the recovered/steady state `node ok`.
- **Use node state to mean something.** `node err` (red) for a failure or degraded state, `node ok` (green) for healthy/recovered, plain for neutral steps. If you use states, the meaning should be obvious from the labels; do not decorate at random.
- **Drop the diagram if it only restates a linear A → B → C** with no condition, timing, or branch. That belongs in a sentence.

A good diagram is one a reader could narrate the failure mode from without reading the surrounding paragraph.

Two shapes:
- **Flow / cascade** (boxes with labeled arrows): reuse `.diagram` / `.box` / `.node`, add `data-node` / `data-rel` to the nodes, and put the condition/timing text inside each `.arrow`. No SVG needed.
- **Relationship graph**: lay out nodes as positioned elements and draw connectors as SVG `<path>` / `<line>` tagged `data-edge="a b"`; an edge lights only when `a` or `b` is focused.

Example (a timed failure cascade — modeled on a max-age/staleness mechanism). Note the labeled arrows and the branch to an error terminal:
```html
<div class="cgmap">
  <div class="diagram"><div class="box"><h4>Config goes stale</h4>
    <div class="node ok" data-node="write" data-rel="poll">Operator writes flag to GCS object</div>
    <div class="arrow">▼ steady state: server polls every 30s</div>
    <div class="node" data-node="poll" data-rel="write serve maxage">Server refreshes its in-memory cache</div>
    <div class="arrow">▼ if the poll fails (GCS unreachable, bad object)</div>
    <div class="node" data-node="maxage" data-rel="poll serve">Cache keeps serving the last good value…</div>
    <div class="arrow">▼ +15m since last success: FLAGS_MAX_AGE trips</div>
    <div class="node err" data-node="serve" data-rel="maxage poll">Server rejects reads with Unavailable rather than serve stale flags</div>
  </div></div>
</div>
```
The value of this diagram is the labels: it shows *when* (every 30s), *why it branches* (poll fails), and *what the threshold does* (+15m → refuse to serve). Hover any node to isolate its neighbours; click to pin.

## Questions JSON

A JSON array. Each item:

```json
{
  "q": "The question text.",
  "opts": ["option A", "option B", "option C", "option D"],
  "correct": 1,
  "expl": "One sentence on why the right answer is right."
}
```

- `correct` is the 0-based index into `opts`.
- `opts`: 2 or more; 3–4 is typical. Make distractors plausible (common misconceptions), with exactly one clearly-correct answer.
- Balance the options so their form gives nothing away. The correct answer must not be longer, more detailed, or more explanatory than the distractors — that is the most common tell and lets a reader pass by picking the wordiest option. Keep every option in a question at roughly the same length and specificity (all terse, or all rich). Never fold the reasoning into the correct option; reasoning belongs in `expl`.
- `expl` is required (a non-empty string); it is shown after grading for every question.
- Aim for 8–12 questions that test understanding (why/what-happens-if), not recall of names. Cover the facts-worth-keeping from the content.

The script validates this shape and exits with a clear error if it is wrong.

## Build

```bash
python3 scripts/build_report.py \
  --title "Short report title" \
  --lede "One-line summary shown under the title." \
  --author "Author Name" \
  --description "One plain sentence describing the report." \
  --content /tmp/report-body.html \
  --questions /tmp/report-questions.json
```

`--author` and `--description` populate `<meta name="author">` and
`<meta name="description">` in the head; a gallery such as arts catalogs the
artifact by them (the description defaults to the lede). See
`arts-colorscheme.md`.

Optional: `--slug my-topic` (else derived from the title), `--pass 0.8` (fraction to pass), `--out-dir /tmp`. It prints the output path.

## Worked example (minimal)

`report-body.html`:
```html
<div class="callout"><div class="k">TL;DR</div><p>We moved widgets from pull to push so updates are instant.</p></div>
<h2>1. How it worked</h2>
<p>Clients polled the widget API every minute…</p>
<div class="callout"><div class="k">Intuition</div><p>Polling trades freshness for simplicity.</p></div>
<h2>2. What changed</h2>
<p>The server now pushes over a stream…</p>
```

`report-questions.json`:
```json
[
  {"q":"Why did polling feel stale?","opts":["The API was slow","Updates only arrived on the next poll","Clients cached forever"],"correct":1,"expl":"Freshness was bounded by the poll interval."}
]
```

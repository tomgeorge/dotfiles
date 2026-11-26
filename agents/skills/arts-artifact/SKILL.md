---
name: arts-artifact
description: Build a self-contained, arts-styled interactive HTML artifact from a prompt — a report (no quiz), briefing, one-pager, explainer with a diagram, or an interactive decision/relationship map — inferring the kind from the request. Use when asked to "build/make an artifact", "an arts artifact", "an interactive map", "a decision map", "a relationship diagram", "a system map", or a standalone HTML page in the arts style, or to visualize a system, decision, or plan as a shareable HTML file for the arts library. For an explainer that ends in a graded quiz, use the arts-report skill instead.
---

# arts artifact

Produce one self-contained HTML file in the arts style that renders inline in the arts library. You supply the substance (and, for a map, the layout); the skill's template and example supply the look and the interactions. Don't use it to change an existing non-arts page.

## Pick the shape
Infer it from the request; ask one question only if it's unclear. If the relationships between things are the point, build a map; if a narrative is, build a document. `references/arts-principles.md` describes both.
- **Document:** a report, briefing, one-pager or memo, or an explainer built around an inline `.cgmap` flow diagram. You write a content fragment, and a script wraps it.
- **Canvas:** an interactive decision, relationship or system map (positioned nodes, arrowed edges, a detail panel, a status legend), or a full-bleed dashboard. You hand-author the whole file from the worked example.

## Document
1. Read the code, docs or conversation the artifact is about.
2. Write the content fragment (HTML, no wrapper) following `references/authoring.md`: its CSS classes, tables over long lists, depth on subtle mechanisms, and an inline `.cgmap` diagram when a flow or relationship is worth showing.
3. Build it. The script adds the arts shell and head metadata, writes to the OS temp dir, and prints the path:
   ```bash
   python3 scripts/build_artifact.py --title "..." --lede "..." \
     --author "..." --description "..." --date YYYY-MM-DD \
     --content /tmp/artifact-body.html
   ```
4. Print only the path, not the HTML.

## Interactive map
Follow `references/interactive-map.md`: read the worked example `references/container_telemetry_map.html` in full, keep its rendering and interaction engine verbatim, and replace its data, statuses and neutrals. Write real, specific detail for each node; the detail panel is where a map earns its value. Add `<title>` and the `author`, `description` and `date` meta tags by hand. Check that the file opens standalone with no console errors, and that hover, click, filter and reset work.

## Rules
- One self-contained file: inline CSS and JS, no CDNs, external fonts or network fetches. It must work from `file://` and inside the arts iframe.
- Always include the head metadata arts catalogs by (`<title>`, author, description, date).
- Match the arts palette in light and dark. The blurple accent is for links and focus or pin only, never a status.
- Never invent data to fill a map or table. Mark unknowns as unknown; the "blocked / unanswered" status exists for this.
- Write to the OS temp dir (or the folder arts watches), never into the repo.

---
name: arts-report
description: Generate a self-contained HTML report that explains a change or topic with context and intuition, ending in a graded multiple-choice quiz the reader must pass. Use when asked for a "report with a quiz", a "study guide", an explainer "I must pass", to be "quizzed" or "tested" on a change, or to teach a topic with a test. Writes the HTML to the OS temp dir and prints the path.
---

# Arts Report

Produce one self-contained HTML file: an explanatory report followed by an interactive, graded quiz that the reader must pass. The report teaches; the quiz checks understanding. Always write the file to the OS temp dir under a human-readable name and print its path.

## When to use

Use when the user asks to understand a change/topic through a written report plus a quiz they must pass, or asks to be quizzed or tested on something. Do not use for a plain doc with no quiz.

## How it works

The look and the quiz engine live in a bundled template; you supply only the content and the questions. A deterministic script injects them and writes the file. This keeps every report consistent and the quiz always working.

```
your content fragment (HTML) + questions (JSON)  --build_report.py-->  /tmp/report-<date>-<slug>.html
```

## Workflow

1. **Understand the subject first.** Read the code, diffs, and conversation the report is about. Do not write the report from assumptions; the reader will be quizzed on it, so it must be accurate.
2. **Write the content fragment.** Author the explanatory sections as an HTML fragment (no `<html>`/`<body>` wrapper, no quiz). Follow the structure and use the CSS classes in `references/authoring.md`: a TL;DR callout, then context, the problem, options/decisions, what was built (always as a `<table>`, one row per change), risks, rollback (state it plainly when rollback is tricky or effectively one-way), and facts worth keeping. Include risks and rollback whenever they apply; if there are none, say so in a line rather than omitting them silently. Lead with intuition, not jargon. Go deep on subtle mechanisms (thresholds, timeouts, fallbacks, ordering) instead of one-lining them — those are what readers misread. When the change is architectural or about event flow or how components relate, include an informative interactive diagram (a `<div class="cgmap">` with `data-node`/`data-rel`) that labels its transitions and shows the failure or branch path rather than just stacking boxes; skip diagrams for simple changes. Save it to a temp file.
3. **Write the questions.** Author a JSON array of multiple-choice questions that test real understanding, not trivia. Schema and guidance are in `references/authoring.md`. Save to a temp file.
4. **Build.** Run the script; it validates the questions, injects everything into the template, writes to the OS temp dir, and prints the path:
   ```bash
   python3 scripts/build_report.py --title "..." --lede "..." \
     --author "..." --description "..." \
     --content /tmp/report-body.html --questions /tmp/report-questions.json
   ```
   Pass `--author` and `--description` so the report carries `<meta name="author">` and `<meta name="description">` — a gallery like arts catalogs artifacts by these (the description defaults to the lede). See `references/arts-colorscheme.md`.
5. **Print only the path** to the user. Do not paste the HTML.

## Output location and naming

Write the file to the OS temp dir, which the build script uses by default (`/tmp`). Name it `report-<YYYY-MM-DD>-<slug>.html`, where `<slug>` is 2–4 kebab-case words describing the topic (derived from the title when `--slug` is not given). These names are for humans: never include a session id, a timestamp beyond the date, or any opaque identifier that is hard to read by eye.

## Rules

- Always write to the OS temp dir, never into the repo.
- Always author the content and questions yourself from the real subject, then let the script assemble them. Never hand-write the surrounding HTML/CSS or the quiz JavaScript.
- Never put the answer key or `correct` indices in the visible content fragment; they live only in the questions JSON, which the engine consumes.
- Keep the quiz honest and unbiased: plausible distractors, one clearly-correct answer, and options of comparable length and detail so the correct one never stands out by its form. Put the reasoning in `expl` (shown after grading), never in the answer text. Give every question a one-line `expl`. Default pass mark is 80%; override with `--pass` only if asked.
- The report title (`--title`) states what the change does functionally, its behaviour or capability, and never a change id, branch, or ticket. Given an opaque name like `vv`, translate it: use `Single supported resource type for policies`, not `The vv change`.

Correct: `--content` is a fragment of `<h2>`/`<p>`/`<div class="callout">` sections; the quiz section is added by the template.

Wrong: pasting a full HTML document into `--content`, or embedding your own `<script>` quiz logic (the template owns it).

## Validate before declaring done

The script fails loudly on a malformed questions file or an unreplaced placeholder. After it prints a path, confirm the quiz parses:

```bash
python3 -c "import re,json,sys; h=open(sys.argv[1]).read(); m=re.search(r'const QUESTIONS = (\[.*?\]);', h, re.S); json.loads(m.group(1).replace('<\\\\/','</')); print('quiz OK')" <printed-path>
```

## Files

- `scripts/build_report.py` — injects content + questions into the template, validates, writes to the OS temp dir, prints the path.
- `assets/report-template.html` — the report shell: styling and the quiz engine, with placeholders for title, author/description head meta, lede, content, questions, and pass mark.
- `references/authoring.md` — content structure, the CSS classes available to the fragment, the questions schema, and a worked example.
- `references/arts-colorscheme.md` — the head metadata and palette to match when a report is meant to blend into the arts artifact library.

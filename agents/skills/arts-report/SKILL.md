---
name: arts-report
description: Generate a self-contained HTML report that explains a change or topic with context and intuition, ending in a graded multiple-choice quiz the reader must pass. Use when asked for a "report with a quiz", a "study guide", an explainer "I must pass", to be "quizzed" or "tested" on a change, or to teach a topic with a test. Writes the HTML to the OS temp dir and prints the path.
---

# Arts report

Produce one self-contained HTML file: a report that teaches a change or topic, followed by a graded quiz the reader must pass. You write the content and the questions; `scripts/build_report.py` puts them into the template, which owns the styling and the quiz engine. For a document with no quiz, use arts-artifact.

## Workflow
1. **Read the subject:** the code, diffs and conversation. The reader is quizzed on the report, so it must be accurate.
2. **Write the content fragment** to a temp file: HTML sections with no `<html>`/`<body>` wrapper, no quiz, and no `<script>`. Follow the structure and CSS classes in `references/authoring.md`:
   - a TL;DR callout, then context, the problem, options and decisions, what was built (a `<table>`, one row per change), risks, rollback, and facts worth keeping;
   - if there are no risks, or rollback is trivial, say so in a line; if rollback is tricky or one-way, say that plainly;
   - lead with intuition, not jargon, and go deep on subtle mechanisms (thresholds, timeouts, fallbacks, ordering), which readers misread;
   - when the change is architectural or about how components or events relate, include an interactive `<div class="cgmap">` diagram that labels transitions and shows the failure or branch path. Skip it for simple changes.
3. **Write the questions** to a temp JSON file, using the schema in `references/authoring.md`. Test understanding, not trivia. Each question has plausible distractors, one clearly correct answer, options of similar length and detail so the answer doesn't stand out, and a one-line `expl` holding the reasoning. Answers never appear in the content fragment.
4. **Build:**
   ```bash
   python3 scripts/build_report.py --title "..." --lede "..." \
     --author "..." --description "..." \
     --content /tmp/report-body.html --questions /tmp/report-questions.json
   ```
   The title states what the change does, never a change ID, branch or ticket: "Single supported resource type for policies", not "The vv change". `--author` and `--description` become the head metadata arts catalogs by (see `references/arts-colorscheme.md`). The pass mark is 80%; change it with `--pass` only if asked. The script writes `/tmp/report-<YYYY-MM-DD>-<slug>.html`; if you pass `--slug`, use 2–4 readable kebab-case words, with no session IDs or other opaque identifiers.
5. **Check the quiz parses:**
   ```bash
   python3 -c "import re,json,sys; h=open(sys.argv[1]).read(); m=re.search(r'const QUESTIONS = (\[.*?\]);', h, re.S); json.loads(m.group(1).replace('<\\\\/','</')); print('quiz OK')" <printed-path>
   ```
6. **Print only the path,** not the HTML.

Never write into the repo.

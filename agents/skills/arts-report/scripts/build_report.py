#!/usr/bin/env python3
"""Build a self-contained HTML learning report with a graded quiz, written to the
OS temp dir under a human-readable name (report-<YYYY-MM-DD>-<slug>.html).

Usage:
  build_report.py --title "..." --content body.html --questions q.json \
      [--lede "..."] [--author "..."] [--description "..."] \
      [--slug my-topic] [--pass 0.8] [--out-dir /tmp]

- --content : path to an HTML fragment (the explanatory sections). Uses the CSS
              classes documented in references/authoring.md. Injected verbatim.
- --questions: path to a JSON array of {q, opts[], correct, expl}. See
              references/authoring.md for the schema. Validated before build.
- --lede    : optional one-line summary shown under the title.
- --author  : optional author, written to <meta name="author"> in the head.
- --description: optional short description, written to <meta name="description">
              in the head; defaults to the lede when omitted. Report libraries
              such as arts read these head tags to catalog the artifact — see
              references/arts-colorscheme.md.
- --pass    : fraction correct required to pass (default 0.8).
- --out-dir : where to write (default /tmp, the OS temp dir).

Prints the output path (only) on success.
"""
import argparse, datetime, html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(os.path.dirname(HERE), "assets", "report-template.html")

def slugify(s):
    words = [w for w in re.sub(r"[^a-z0-9]+", "-", s.lower()).split("-") if w]
    return "-".join(words[:4]) or "report"

def validate_questions(data):
    if not isinstance(data, list) or not data:
        sys.exit("questions must be a non-empty JSON array")
    for i, q in enumerate(data):
        tag = f"question[{i}]"
        if not isinstance(q, dict):
            sys.exit(f"{tag}: not an object")
        for k in ("q", "opts", "correct"):
            if k not in q:
                sys.exit(f"{tag}: missing '{k}'")
        if not isinstance(q["q"], str) or not q["q"].strip():
            sys.exit(f"{tag}: 'q' must be a non-empty string")
        if not isinstance(q["opts"], list) or len(q["opts"]) < 2:
            sys.exit(f"{tag}: 'opts' must be a list of 2+ options")
        if not all(isinstance(o, str) for o in q["opts"]):
            sys.exit(f"{tag}: every option must be a string")
        if not isinstance(q["correct"], int) or isinstance(q["correct"], bool) \
           or not (0 <= q["correct"] < len(q["opts"])):
            sys.exit(f"{tag}: 'correct' must be an index into opts")
        if not isinstance(q.get("expl"), str) or not q["expl"].strip():
            sys.exit(f"{tag}: 'expl' is required (a non-empty string)")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--content", required=True)
    ap.add_argument("--questions", required=True)
    ap.add_argument("--lede", default="")
    ap.add_argument("--author", default="")
    ap.add_argument("--description", default="")
    ap.add_argument("--slug", default="")
    ap.add_argument("--pass", dest="passfrac", type=float, default=0.8)
    ap.add_argument("--out-dir", default="/tmp")
    a = ap.parse_args()

    if not (0 < a.passfrac <= 1):
        sys.exit("--pass must be in (0, 1]")

    def read_text(path):
        with open(path, encoding="utf-8") as f:
            return f.read()

    tpl = read_text(TEMPLATE)
    content = read_text(a.content)
    try:
        questions = json.loads(read_text(a.questions))
    except json.JSONDecodeError as e:
        sys.exit(f"--questions is not valid JSON: {e}")
    validate_questions(questions)

    # The template must contain each placeholder before we inject anything: a
    # no-op replace against a template that lost a token would otherwise pass
    # silently and ship a broken report.
    required = ["__TITLE__", "<!--__AUTHORMETA__-->", "<!--__DESCMETA__-->",
                "<!--__LEDE__-->", "<!--__CONTENT__-->",
                "/*__QUESTIONS__*/", "/*__PASS__*/"]
    for token in required:
        if token not in tpl:
            sys.exit(f"ERROR: template is missing placeholder {token}")

    lede_html = f'<p class="lede">{html.escape(a.lede)}</p>' if a.lede.strip() else ""
    # Head meta a report library (e.g. arts) reads to catalog the artifact. The
    # description falls back to the lede so a report is never left undescribed.
    author = a.author.strip()
    description = a.description.strip() or a.lede.strip()
    author_meta = f'<meta name="author" content="{html.escape(author)}">' if author else ""
    desc_meta = f'<meta name="description" content="{html.escape(description)}">' if description else ""
    qjson = json.dumps(questions, ensure_ascii=False).replace("</", "<\\/")

    # Expand every placeholder in a SINGLE pass. Sequential str.replace calls
    # would rescan already-injected blobs (the questions JSON, the content
    # fragment) for later sentinels, so a fragment that happened to contain one
    # would be corrupted. A single re.sub never re-examines its own output, so a
    # report may freely mention any placeholder text without breaking.
    replacements = {
        "__TITLE__": html.escape(a.title),
        "<!--__AUTHORMETA__-->": author_meta,
        "<!--__DESCMETA__-->": desc_meta,
        "<!--__LEDE__-->": lede_html,
        "<!--__CONTENT__-->": content,
        "/*__QUESTIONS__*/": qjson,
        "/*__PASS__*/": repr(float(a.passfrac)),
    }
    token_re = re.compile("|".join(re.escape(tok) for tok in replacements))
    out = token_re.sub(lambda m: replacements[m.group(0)], tpl)

    slug = slugify(a.slug) if a.slug.strip() else slugify(a.title)
    today = datetime.date.today().isoformat()
    dest = os.path.join(a.out_dir, f"report-{today}-{slug}.html")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(out)
    print(dest)

if __name__ == "__main__":
    main()

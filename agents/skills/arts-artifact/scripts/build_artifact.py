#!/usr/bin/env python3
"""Wrap an authored HTML content fragment in the arts-styled document shell and
write a self-contained artifact to the OS temp dir under a human-readable name
(artifact-<YYYY-MM-DD>-<slug>.html).

Use this for document-style artifacts — a report (no quiz), briefing, one-pager,
memo, or a page whose centrepiece is an inline `.cgmap` diagram. For a full-bleed
INTERACTIVE MAP (positioned nodes, edges, a detail panel), do not use this shell:
adapt references/container_telemetry_map.html instead, see
references/interactive-map.md.

Usage:
  build_artifact.py --title "..." --content body.html \
      [--lede "..."] [--author "..."] [--description "..."] [--date YYYY-MM-DD] \
      [--slug my-topic] [--out-dir /tmp]

- --content : path to an HTML fragment (the artifact body). Uses the CSS classes
              documented in references/authoring.md. Injected verbatim.
- --lede    : optional one-line summary shown under the title.
- --author  : optional author, written to <meta name="author"> in the head.
- --description: optional short description, written to <meta name="description">;
              defaults to the lede. The arts library reads these head tags to
              catalog the artifact — see references/arts-principles.md.
- --date    : optional YYYY-MM-DD, written to <meta name="date">; arts sorts by
              it (else it falls back to the file's modified time).
- --out-dir : where to write (default /tmp, the OS temp dir).

Prints the output path (only) on success.
"""
import argparse, datetime, html, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(os.path.dirname(HERE), "assets", "artifact-template.html")


def slugify(s):
    words = [w for w in re.sub(r"[^a-z0-9]+", "-", s.lower()).split("-") if w]
    return "-".join(words[:4]) or "artifact"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--content", required=True)
    ap.add_argument("--lede", default="")
    ap.add_argument("--author", default="")
    ap.add_argument("--description", default="")
    ap.add_argument("--date", default="")
    ap.add_argument("--slug", default="")
    ap.add_argument("--out-dir", default="/tmp")
    a = ap.parse_args()

    # Normalize --date to canonical YYYY-MM-DD. fromisoformat accepts other ISO
    # forms (e.g. 20260729, 2026-W31-3); re-emitting .isoformat() guarantees the
    # dashed form the arts library parses, instead of passing an odd form through
    # to <meta name="date"> where arts would ignore it and fall back to mtime.
    date = a.date.strip()
    if date:
        try:
            date = datetime.date.fromisoformat(date).isoformat()
        except ValueError:
            sys.exit("--date must be an ISO date (YYYY-MM-DD)")

    def read_text(path):
        with open(path, encoding="utf-8") as f:
            return f.read()

    tpl = read_text(TEMPLATE)
    content = read_text(a.content)

    # The template must contain each placeholder before we inject anything: a
    # no-op replace against a template that lost a token would otherwise pass
    # silently and ship a broken artifact.
    required = ["__TITLE__", "<!--__AUTHORMETA__-->", "<!--__DESCMETA__-->",
                "<!--__DATEMETA__-->", "<!--__LEDE__-->", "<!--__CONTENT__-->"]
    for token in required:
        if token not in tpl:
            sys.exit(f"ERROR: template is missing placeholder {token}")

    lede_html = f'<p class="lede">{html.escape(a.lede)}</p>' if a.lede.strip() else ""
    # Head meta the arts library reads to catalog the artifact. Description falls
    # back to the lede so an artifact is never left undescribed.
    author = a.author.strip()
    description = a.description.strip() or a.lede.strip()
    author_meta = f'<meta name="author" content="{html.escape(author)}">' if author else ""
    desc_meta = f'<meta name="description" content="{html.escape(description)}">' if description else ""
    date_meta = f'<meta name="date" content="{html.escape(date)}">' if date else ""

    # Expand every placeholder in a SINGLE pass. Sequential str.replace calls
    # would rescan already-injected content for later sentinels, so a body that
    # happened to contain one would be corrupted. A single re.sub never
    # re-examines its own output.
    replacements = {
        "__TITLE__": html.escape(a.title),
        "<!--__AUTHORMETA__-->": author_meta,
        "<!--__DESCMETA__-->": desc_meta,
        "<!--__DATEMETA__-->": date_meta,
        "<!--__LEDE__-->": lede_html,
        "<!--__CONTENT__-->": content,
    }
    token_re = re.compile("|".join(re.escape(tok) for tok in replacements))
    out = token_re.sub(lambda m: replacements[m.group(0)], tpl)

    slug = slugify(a.slug) if a.slug.strip() else slugify(a.title)
    today = datetime.date.today().isoformat()
    dest = os.path.join(a.out_dir, f"artifact-{today}-{slug}.html")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(out)
    print(dest)


if __name__ == "__main__":
    main()

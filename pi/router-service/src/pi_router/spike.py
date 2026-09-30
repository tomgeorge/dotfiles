"""Phase 0 spike: run every backend over the labelled task set and report how each does.

    uv run pi-router-spike                      # all backends
    uv run pi-router-spike --backends arch-router
    uv run pi-router-spike --out results.jsonl  # keep per-task rankings
"""

from __future__ import annotations

import argparse
import ast
import json
import statistics
from collections import Counter, defaultdict
from itertools import pairwise
from pathlib import Path

from .backends import ArchRouterBackend, LayaBackend

EVAL_DIR = Path(__file__).resolve().parents[2] / "eval"
# The same routes pi sends, so the evaluation measures what's deployed.
ROUTES_FILE = Path(__file__).resolve().parents[3] / "subagent-routes.json"
BACKENDS = {
    "laya-english": lambda: LayaBackend("english"),
    "laya-typed-decisions": lambda: LayaBackend("typed-decisions"),
    "arch-router": lambda: ArchRouterBackend(),
}


def greedy_route(text: str) -> str | None:
    # Arch-Router tends to answer with a Python dict literal rather than JSON.
    try:
        value = ast.literal_eval(text)
    except (ValueError, SyntaxError):
        return None
    return value.get("route") if isinstance(value, dict) else None


def calibration(rows: list[tuple[float, bool]], bins=(0.0, 0.4, 0.6, 0.8, 1.01)) -> list[str]:
    lines = []
    for lo, hi in pairwise(bins):
        hits = [ok for p, ok in rows if lo <= p < hi]
        if hits:
            lines.append(f"    p∈[{lo:.1f},{min(hi, 1):.1f}): n={len(hits):2d}  accuracy={sum(hits) / len(hits):.2f}")
    return lines


def report(name: str, results: list[dict], routes: list[str]) -> None:
    n = len(results)
    top1 = sum(r["top1"] == r["route"] for r in results)
    lenient = sum(r["top1"] == r["route"] or r["top1"] in r["alt"] for r in results)
    top3 = sum(r["route"] in r["top3"] for r in results)
    lat = [r["latency_ms"] for r in results]
    print(f"\n=== {name} ===")
    print(f"  top-1 {top1}/{n} ({top1 / n:.0%})   top-1 incl. alt labels {lenient / n:.0%}   top-3 {top3 / n:.0%}")
    print(f"  latency p50 {statistics.median(lat):.0f} ms   max {max(lat):.0f} ms")

    per = defaultdict(lambda: [0, 0])
    confusion = Counter()
    for r in results:
        per[r["route"]][1] += 1
        per[r["route"]][0] += r["top1"] == r["route"]
        if r["top1"] != r["route"]:
            confusion[(r["route"], r["top1"])] += 1
    print("  per route: " + "  ".join(f"{k} {v[0]}/{v[1]}" for k, v in sorted(per.items())))
    if confusion:
        print("  most common mistakes (label → predicted): "
              + ", ".join(f"{a}→{b}×{c}" for (a, b), c in confusion.most_common(6)))
    print("  calibration (top-1 probability vs accuracy):")
    print("\n".join(calibration([(r["p"], r["top1"] == r["route"]) for r in results])))

    trunc = [r for r in results if r["extra"].get("truncated")]
    if trunc:
        print(f"  truncated inputs: {len(trunc)} ({sum(r['top1'] == r['route'] for r in trunc)} still correct)")
    if "greedy" in results[0]["extra"]:
        agree = sum(greedy_route(r["extra"]["greedy"]) == r["top1"] for r in results)
        greedy_ok = sum(greedy_route(r["extra"]["greedy"]) == r["route"] for r in results)
        print(f"  scored top-1 matches greedy output: {agree}/{n}   greedy accuracy: {greedy_ok}/{n}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backends", default=",".join(BACKENDS), help="comma-separated: " + ", ".join(BACKENDS))
    parser.add_argument("--tasks", type=Path, default=EVAL_DIR / "tasks.jsonl")
    parser.add_argument("--routes", type=Path, default=ROUTES_FILE, help="pi's subagent-routes.json")
    parser.add_argument("--out", type=Path, help="write per-task rankings as JSONL")
    args = parser.parse_args()

    routes = {name: r["description"] for name, r in json.loads(args.routes.read_text())["routes"].items()}
    tasks = [json.loads(line) for line in args.tasks.read_text().splitlines() if line.strip()]
    names = [b.strip() for b in args.backends.split(",") if b.strip()]
    unknown = set(names) - set(BACKENDS)
    if unknown:
        parser.error(f"unknown backends: {', '.join(sorted(unknown))}")

    out = args.out.open("w") if args.out else None
    try:
        for name in names:
            backend = BACKENDS[name]()
            backend.rank("warm up", routes)  # first call pays for MPS kernel compilation
            results = []
            for t in tasks:
                r = backend.rank(t["task"], routes, greedy=True)
                row = {"backend": name, "route": t["route"], "alt": t["alt"], "task": t["task"][:120],
                       "top1": r.ranked[0][0], "p": r.ranked[0][1], "top3": [k for k, _ in r.ranked[:3]],
                       "ranked": r.ranked, "latency_ms": r.latency_ms, "extra": r.extra}
                results.append(row)
                if out:
                    out.write(json.dumps(row) + "\n")
            report(name, results, list(routes))
            del backend
    finally:
        if out:
            out.close()


if __name__ == "__main__":
    main()

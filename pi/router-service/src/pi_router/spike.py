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


# Difficulty experiments: variant name -> (backend key in BACKENDS, Laya question mode).
DIFFICULTY_VARIANTS = {
    "arch-router": ("arch-router", "choice"),
    "laya-typed-decisions:choice": ("laya-typed-decisions", "choice"),
    "laya-typed-decisions:score": ("laya-typed-decisions", "score"),
    "laya-english:choice": ("laya-english", "choice"),
}


def report_difficulty(name: str, results: list[dict], levels: list[str]) -> None:
    n = len(results)
    idx = {lv: i for i, lv in enumerate(levels)}
    exact = sum(r["top1"] == r["label"] for r in results)
    within = sum(abs(idx[r["top1"]] - idx[r["label"]]) <= 1 for r in results)
    under = sum(idx[r["top1"]] < idx[r["label"]] for r in results)
    over = sum(idx[r["top1"]] > idx[r["label"]] for r in results)
    lat = [r["latency_ms"] for r in results]
    print(f"\n=== {name} (difficulty) ===")
    print(f"  exact {exact}/{n} ({exact / n:.0%})   within one level {within / n:.0%}   "
          f"too low {under}   too high {over}   latency p50 {statistics.median(lat):.0f} ms")
    predicted = Counter(r["top1"] for r in results)
    print("  predicted: " + "  ".join(f"{lv} {predicted[lv]}" for lv in levels))
    confusion = Counter((r["label"], r["top1"]) for r in results if r["top1"] != r["label"])
    if confusion:
        print("  mistakes (label → predicted): "
              + ", ".join(f"{a}→{b}×{c}" for (a, b), c in confusion.most_common(6)))
    print("  calibration (top-1 probability vs accuracy):")
    print("\n".join(calibration([(r["p"], r["top1"] == r["label"]) for r in results])))


def run_difficulty(backends: str | None, tasks: list[dict], levels: dict[str, str], out) -> None:
    tasks = [t for t in tasks if t.get("difficulty")]
    common, count = Counter(t["difficulty"] for t in tasks).most_common(1)[0]
    print(f"baseline: always '{common}' is right {count}/{len(tasks)} ({count / len(tasks):.0%})")
    names = [b.strip() for b in backends.split(",") if b.strip()] if backends else list(DIFFICULTY_VARIANTS)
    unknown = sorted(set(names) - set(DIFFICULTY_VARIANTS))
    if unknown:
        raise SystemExit(f"unknown difficulty variants {unknown}; choose from {', '.join(DIFFICULTY_VARIANTS)}")
    loaded: dict[str, object] = {}
    for name in names:
        key, mode = DIFFICULTY_VARIANTS[name]
        if key not in loaded:
            loaded.clear()  # one model resident at a time
            loaded[key] = BACKENDS[key]()
        backend = loaded[key]
        backend.rate("warm up", levels, mode=mode)
        results = []
        for t in tasks:
            r = backend.rate(t["task"], levels, mode=mode)
            row = {"variant": name, "label": t["difficulty"], "task": t["task"][:120], "top1": r.ranked[0][0],
                   "p": r.ranked[0][1], "ranked": r.ranked, "latency_ms": r.latency_ms}
            results.append(row)
            if out:
                out.write(json.dumps(row) + "\n")
        report_difficulty(name, results, list(levels))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backends", help="comma-separated: " + ", ".join(BACKENDS)
                        + "; with --difficulty: " + ", ".join(DIFFICULTY_VARIANTS))
    parser.add_argument("--difficulty", action="store_true", help="evaluate difficulty ratings instead of routes")
    parser.add_argument("--tasks", type=Path, default=EVAL_DIR / "tasks.jsonl")
    parser.add_argument("--routes", type=Path, default=ROUTES_FILE, help="pi's subagent-routes.json")
    parser.add_argument("--out", type=Path, help="write per-task rankings as JSONL")
    args = parser.parse_args()

    config = json.loads(args.routes.read_text())
    routes = {name: r["description"] for name, r in config["routes"].items()}
    tasks = [json.loads(line) for line in args.tasks.read_text().splitlines() if line.strip()]
    if args.difficulty:
        levels = {n: lv["description"] for n, lv in config["difficulty"]["levels"].items()}
        out = args.out.open("w") if args.out else None
        try:
            run_difficulty(args.backends, tasks, levels, out)
        finally:
            if out:
                out.close()
        return
    names = [b.strip() for b in (args.backends or ",".join(BACKENDS)).split(",") if b.strip()]
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

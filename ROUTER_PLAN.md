# Plan: local "System 1" model router for subagents

Goal: describe a subagent task, have a small local model rank which model
should run it, and confirm the choice in a picker. Two routers run behind one
interface, Laya and Arch-Router, so they can be compared on real use.

Non-goals for now: choosing a model without confirmation, routing the parent
session's own model, non-engineering tasks.

---

## The two routers

| | Laya (`convaiinnovations/laya`) | Arch-Router (`katanemo/Arch-Router-1.5B`) |
|---|---|---|
| Kind | Encoder classifier (ModernBERT-large, ~421M) with decision heads | Generative LLM (Qwen2.5-based, 1.5B) trained on a routing prompt |
| Input | state + typed questions (`choice`, `score`, `noul`) | Route list (name + description) + conversation, fixed prompt format |
| Output | Probability distribution over `choice` options | One JSON string: `{"route": "name"}` |
| Context | 512 tokens by default (English) | Long, 32k+ |
| Runtime | `pip install laya`, PyTorch (MPS on Apple Silicon) | `transformers`, PyTorch |
| License | Apache 2.0 | Katanemo license (custom; fine for personal use, read before sharing) |
| Size in memory | ~1 GB | ~3 GB in bf16 |

Sources: the upstream Laya README (github.com/NandhaKishorM/laya, v0.3.21) and
the Arch-Router model card on Hugging Face.

**Arch-Router only returns a single route.** To get a ranked list with scores
comparable to Laya's, the service scores each candidate: it computes the
log-probability of the continuation `{"route": "<name>"}` for every route
(one batched forward pass) and applies softmax across routes. It also records
the greedy answer, to check that scoring agrees with what the model would
generate. This scoring method is our own, not upstream's; phase 0 checks it.

**Laya's context is small.** The English checkpoint reads 512 tokens and
`laya-typed-decisions` reads 1,024, shared between the question and the task.
Options get a separate budget of 192 tokens, with each option description cut
to 48 tokens, so route descriptions must stay short. Past the limit, the
end of the task is dropped silently. Laya reports this as `usage.truncated`,
and the service passes it through.

---

## Architecture

```
pi (subagent extension)                    router service (Python, localhost)
┌───────────────────────────┐   HTTP     ┌──────────────────────────────┐
│ router.ts                 │──────────▶ │ POST /v1/route               │
│  - load routes config     │  ≤3 s      │   backends: arch, laya       │
│  - call service           │  timeout   │ GET /health                  │
│  - map routes → models    │ ◀──────────│ both models preloaded        │
│  - filter by availability │            └──────────────────────────────┘
│  - log decision + pick    │              launchd agent (darwin)
│ index.ts: picker, tool    │
└───────────────────────────┘
```

### One service, two backends

A single Python service loads both models at startup and exposes one API.
Reasons:

- One launchd agent, one port, one health check.
- In compare mode, one request returns both rankings for the same input.
- Routes come in with each request, so the service holds no state and
  editing routes doesn't need a restart.

`laya-serve` isn't used directly: it would mean a second process for
Arch-Router and a second wire format. The Laya library runs in-process
instead.

### Service API

```http
POST /v1/route
{
  "task": "Review the retry logic in runner.ts for races",
  "routes": [{"name": "review", "description": "..."}, ...],
  "backends": ["arch-router", "laya-typed-decisions"]
}

200
{
  "results": {
    "laya": {"ranked": [{"route": "review", "p": 0.81}, ...],
             "truncated": false, "latency_ms": 42,
             "model": "convaiinnovations/laya", "revision": "<sha>"},
    "arch": {"ranked": [...], "greedy": "review", "latency_ms": 180,
             "model": "katanemo/Arch-Router-1.5B", "revision": "<sha>"}
  }
}
```

Both backends always get an implicit `other` route. If `other` ranks first,
or the top score is below the threshold, the result counts as "unsure".
A backend that fails returns `{"error": "..."}` and doesn't fail the others.

`GET /health` reports whether each model is loaded, the device it runs on
(`mps`/`cpu`), and the pinned revisions.

### Packaging and service (Nix)

- Code: `pi/router-service/`, a `uv` project (`pyproject.toml` +
  `uv.lock`) with `laya`, `transformers`, `torch`, `fastapi`, `uvicorn`.
  `laya` isn't in nixpkgs, and torch with MPS support is painful to build
  through Nix on darwin. A locked uv environment is the pragmatic choice.
- Nix: new `nix/modules/features/pi-router.nix` home-manager module:
  - adds `uv` to `home.packages`.
  - darwin: `launchd.agents.pi-router` with `RunAtLoad`, `KeepAlive`, logs
    in `~/Library/Logs/pi-router.log`.
  - command: `uv run --frozen --project <dotfiles>/pi/router-service pi-router-serve`.
  - env: `PI_ROUTER_HOST=127.0.0.1`, `PI_ROUTER_PORT=8765`,
    `PI_ROUTER_DEVICE=mps`, `HF_HUB_OFFLINE=1`.
- Model revisions are pinned in `pi_router/service.py`, so the service and
  `make router-warm` always agree.
- Imported via both `tom` users behind `isDarwin`, so only the Macs get it;
  no systemd unit for now.
- Binds to loopback only. No authentication, since it runs no tools and
  returns only rankings.
- Model weights are downloaded once into the Hugging Face cache by a
  `make router-warm` target, which keeps the first service start from
  timing out on a download.

---

## Pi side

### Routes config: `~/.pi/agent/subagent-routes.json`

Kept in dotfiles as `pi/subagent-routes.json` and linked by `link.sh`.

```json
{
  "service": "http://127.0.0.1:8765",
  "backends": ["arch-router", "laya-typed-decisions"],
  "primary": "arch-router",
  "threshold": 0.5,
  "routes": {
    "implement":    {"description": "Write new code or features from a description or spec", "models": []},
    "debug":        {"description": "Diagnose a failure, error message, or unexpected behaviour and find its cause", "models": []},
    "review":       {"description": "Review existing code or a diff for bugs, security problems, and correctness", "models": []},
    "architecture": {"description": "Design systems, compare approaches, plan changes across components, weigh tradeoffs", "models": []},
    "explore":      {"description": "Find where something lives in a codebase, explain how code works, summarize files", "models": []},
    "test":         {"description": "Design or write tests, find missing test coverage", "models": []}
  }
}
```

`models` holds exact `provider/model` IDs in order of preference. Starting
choices, based on vendor launch posts (not per-category benchmarks):

| Route | Models |
|---|---|
| implement | `openai-codex/gpt-6.1-sol`, `anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-5-5` |
| debug | `openai-codex/gpt-6.1-sol`, `anthropic/claude-fable-5-1` |
| review | `anthropic/claude-opus-5-5`, `openai-codex/gpt-6.1-sol` (other vendor as a second opinion) |
| architecture | `anthropic/claude-fable-5-1`, `openai-codex/gpt-6-astra` |
| explore | `openai-codex/gpt-6-luna`, `anthropic/claude-sonnet-5-5` |
| test | `anthropic/claude-sonnet-5-5`, `openai-codex/gpt-6.1-sol` |

Reasoning: Fable 5 is Anthropic's most capable general-release model, so it
gets reasoning-heavy work. GPT-6.1 Sol nearly matches GPT-6 Astra on agentic
coding at a fifth of the price. Luna is OpenAI's cheap tier, fine for lookup.
The `-5-1` Fable variant hasn't been checked separately from Fable 5.
Models not in `modelRegistry.getAvailable()` are dropped at runtime, with a
warning in the picker header.

**Subagents are read-only.** Children get only `read`, `grep`, `find`, `ls`
and read-only `git`, so `implement` and `test` tasks produce proposed
patches as text, not edits. The routes still work, since which model is
best doesn't depend on who applies the patch. Worth deciding whether to keep
them.

### `router.ts` (pure, no Pi imports, like `runner.ts`)

- `loadRoutes(path)`: parse and validate the config (unknown backend,
  empty description, and duplicate route names are errors).
- `route(task, config, {signal, timeoutMs})`: calls the service. On timeout
  or connection error it returns `{status: "unavailable"}`, never throws, so
  the caller can fall back to the plain picker.
- `buildChoices(results, config, available)`: turns route rankings into
  picker rows `{route, model, scores: {laya, arch}}`, sorted by the primary
  backend's score and then by the route's model order. Keeps a model listed
  under several routes once, at its best position. Ends with "All models…".
- `logDecision(entry)`: appends to `~/.pi/agent/router/decisions.jsonl`
  (mode 0600): time, task text, each backend's ranking, latency and
  truncation, the row you picked, and whether you took the primary backend's
  top pick or left the list for "All models…".

### Confirmation, enforced in code

- **`subagent` tool**: `provider`/`model` become optional. When omitted, the
  extension routes the task and opens `ctx.ui.select` with the ranked rows.
  The job runs only after you pick. Without a UI, the call fails with "model
  required". When a model is given, behaviour is unchanged. This keeps the
  README's "no automatic model selection" rule: the router only suggests.
- **`/subagent` with no arguments**: task editor first, then the ranked
  picker. This reverses today's model-then-task order. With
  `/subagent provider/model task`, nothing changes.
- **Picker rows in compare mode**, one row per model:
  `anthropic/claude-opus-5-5   architecture   laya 0.81 · arch 0.64`
  The header shows `laya: architecture · arch: review (disagree)` when the
  two backends' top picks differ.
- If the service is unavailable or unsure, the full model list opens with a
  one-line reason in the header.

### Comparing the two

Two sources of labels:

1. **Offline set**: `pi/router-service/eval/tasks.jsonl`, 40–60 hand-labelled
   engineering tasks (seeded from past `subagent` calls in
   `~/.pi/agent/sessions/*.jsonl`). `uv run pi-router-eval` reports, per
   backend: top-1/top-3 accuracy, confusion matrix, calibration (does p≈0.8
   mean right ~80% of the time?), p50/p95 latency, and truncation rate.
2. **Online log**: each confirmation in the picker is a label.
   `pi-router-eval --log ~/.pi/agent/router/decisions.jsonl` runs the same
   report on real use. This log is also the data needed to turn on
   auto-select later.

---

## Phases

0. **Spike (no Pi changes).** A script that loads both models and runs the
   offline set. Checks: that Arch-Router's per-route scoring matches its
   greedy output, Laya's truncation, latency on MPS. Stop if neither backend
   beats ~70% top-1 on six routes.
1. **Service + Nix.** *Done; see `pi/router-service/README.md`.* `pi/router-service` with `/v1/route` and `/health`,
   pytest against small fake backends, the home-manager module, and the
   `make router-warm` target.
2. **`router.ts` + config + tests.** Node tests against a local fake HTTP
   server (same style as `runner.test.ts`): ranking, availability filtering,
   duplicate models, timeout → unavailable, unsure → fallback.
3. **Pi integration.** Optional model on the tool, reordered `/subagent`,
   compare-mode picker, decision log, README update.
4. **Eval report.** `pi-router-eval` for the offline set and the log.
5. **Later: auto-select.** Config such as
   `"autoSelect": {"backend": "laya", "minP": 0.9, "requireAgreement": true}`.
   Off by default; turn on only once the log shows the scores are reliable.
   Even then, show which model was chosen and why.

## Decisions

- Keep `implement` and `test` even though subagents are read-only.
- The Katanemo license is acceptable.
- The service runs on the Macs only; meerkat is left out for now.

## Phase 0 results

Run with `cd pi/router-service && uv run pi-router-spike` (uv via
`nix shell nixpkgs#uv` until the Nix module lands). 59 labelled tasks in
`eval/tasks.jsonl`: 8 real past subagent tasks (all reviews), 48 hand-written
(~8 per route), 4 non-engineering tasks, 3 long tasks where the goal comes
after ~450 tokens of context. Routes are in `eval/routes.json`, first draft
without tuning. M-series Mac, MPS.

| Backend | Top-1 | Top-3 | p50 latency | Notes |
|---|---|---|---|---|
| `laya-english` | 83% | 93% | 55 ms | Weak on `explore`/`debug`. Missed 2 of 3 long tasks (truncated at 512 tokens) |
| `laya-typed-decisions` | 92% | 100% | 53 ms | 1,024-token context, no truncation. Flat probabilities: 45 of 59 top picks under 0.6, though 0.4–0.6 was always right |
| `arch-router` | 97% | 100% | 550 ms | Only misses: two `test` tasks → `implement` (p 0.77 and 0.96) |

Findings:

- **Arch-Router answers with a Python dict** (`{'route': 'debug'}`), not the
  JSON its prompt asks for. The scorer counts both spellings; scored top-1
  then matches its greedy output 59/59, which validates the scoring method.
- **Laya's probabilities can't use one shared threshold.** typed-decisions
  ranks well but is rarely confident; Arch-Router is confident even when wrong.
  So "unsure" needs a rule per backend (e.g. Arch-Router: top p < 0.6;
  Laya typed: margin between the top two < 0.1), tuned from the online log.
- **Use `laya-typed-decisions`, not `laya-english`.** It is more accurate,
  and its larger context avoids the truncation failures.
- **Proposed default:** `primary: arch-router`, with `laya-typed-decisions`
  as the comparison backend. Arch-Router's 0.5 s is fine for a picker.
- **Memory and disk:** 4.5 GB of Hugging Face cache (both Laya checkpoints
  plus Arch-Router), and a 750 MB virtualenv.

Caveat: I wrote the hand-labelled tasks knowing the route descriptions, and
they are short and clean. Real tasks are longer and start with role
instructions ("You are an adversarial reviewer…"). Expect lower accuracy in
real use; the online log (phase 3) is the real test. Go decision: proceed.

## Open questions

- Unsure rules per backend: set them once the online log has ~50 entries.

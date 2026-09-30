# pi-router

A local service that ranks which kind of work a subagent task is (`debug`,
`review`, `architecture`, ...) so pi can suggest models for it. It runs two
small models side by side so they can be compared:

- **Arch-Router** (`katanemo/Arch-Router-1.5B`, Katanemo license): a generative
  router. Every route is scored by the log-probability of the model answering
  with it, then softmaxed across routes.
- **Laya typed-decisions** (`convaiinnovations/laya`, Apache 2.0): an encoder
  classifier that returns a distribution over the routes directly.

Both add an implicit `other` route for tasks that match none. Design and
evaluation results are in [`ROUTER_PLAN.md`](../../ROUTER_PLAN.md).

## Run

On macOS, the `piRouter` home-manager module (`nix/modules/features/pi-router.nix`)
installs `uv` and a launchd agent that runs the service at login on
`127.0.0.1:8765`. The agent runs offline, so download the pinned models once
first (about 4.5 GB into `~/.cache/huggingface`):

```sh
make router-warm        # from the repo root
sudo darwin-rebuild switch --flake ~/git/dotfiles/nix
curl -s localhost:8765/health
```

Logs: `~/Library/Logs/pi-router.log`. Restart after changing code or the lockfile:

```sh
launchctl kickstart -k gui/$(id -u)/org.nix-community.home.pi-router
```

Model revisions are pinned in `src/pi_router/service.py`; both the agent and
`make router-warm` use them. To upgrade, change them, run `make router-warm`,
then restart the agent.

## API

```sh
curl -s localhost:8765/v1/route -H 'content-type: application/json' -d '{
  "task": "Where is the subagent concurrency limit enforced?",
  "routes": [{"name": "explore", "description": "Locate code or explain how it works"},
             {"name": "debug", "description": "Find the cause of a failure"}],
  "backends": ["arch-router"]
}'
```

- `backends` is optional (default: every loaded backend). `greedy: true` also
  returns Arch-Router's own generated answer, at about twice the latency.
- Each backend result has `ranked` (best first, `p` sums to 1), `latency_ms`,
  `model` and `revision`. Laya also reports `truncated` when the task didn't
  fit its 1,024-token context.
- A backend that fails returns `{"error": "..."}`; the others still answer.
- Route names are lowercase, at most 32 characters, not `other`, and unique.
  Keep descriptions short: Laya cuts each one to 48 tokens.

## Configuration

| Variable | Default |
|---|---|
| `PI_ROUTER_HOST` | `127.0.0.1` |
| `PI_ROUTER_PORT` | `8765` |
| `PI_ROUTER_DEVICE` | `mps` if available, else `cpu` |
| `PI_ROUTER_BACKENDS` | `arch-router,laya-typed-decisions` (also: `laya-english`) |
| `PI_ROUTER_ARCH_REVISION`, `PI_ROUTER_LAYA_REVISION` | the commits pinned in `service.py` |
| `HF_HUB_OFFLINE` | set to `1` by the agent |

## Develop

```sh
make router-test        # service tests with fake backends; no models needed
make router-lint
make router-spike       # evaluate every backend on eval/tasks.jsonl (loads real models)
```

Outside the home-manager setup, prefix with `nix shell nixpkgs#uv -c`.
`eval/tasks.jsonl` holds labelled tasks and `eval/routes.json` the route
descriptions used for evaluation. Keep the tasks free of private details:
this repository is public.

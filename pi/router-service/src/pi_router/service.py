"""HTTP service: rank a subagent task against routes with every loaded backend.

    POST /v1/route  {"task": "...", "routes": [{"name", "description"}], "backends": [...]}
    GET  /health

Configured by environment variables (see `Settings.from_env`). Binds to loopback by default;
there is no authentication, since the service runs no tools and only returns rankings.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from .backends import OTHER, Ranking

log = logging.getLogger("pi_router")

ROUTE_NAME = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


class Backend(Protocol):
    name: str
    model_id: str
    revision: str | None
    device: str

    def rank(self, task: str, routes: dict[str, str], greedy: bool = False) -> Ranking: ...


def _arch(device: str | None, revision: str | None) -> Backend:
    from .backends import ArchRouterBackend

    return ArchRouterBackend(device=device, revision=revision)


def _laya(checkpoint: str) -> Callable[[str | None, str | None], Backend]:
    def build(device: str | None, revision: str | None) -> Backend:
        from .backends import LayaBackend

        return LayaBackend(checkpoint, device=device, revision=revision)

    return build


# Pinned Hugging Face commits, shared by the service and `pi-router-warm` so the warmed cache
# always matches what the service loads offline. To upgrade: change these, `make warm`, restart.
ARCH_REVISION = "5b156890a91b1035a86f82faf1a651debf309009"
LAYA_REVISION = "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"  # bundle repo: every Laya checkpoint

# name -> (factory, env var that overrides the revision, pinned revision)
FACTORIES: dict[str, tuple[Callable[[str | None, str | None], Backend], str, str]] = {
    "arch-router": (_arch, "PI_ROUTER_ARCH_REVISION", ARCH_REVISION),
    "laya-typed-decisions": (_laya("typed-decisions"), "PI_ROUTER_LAYA_REVISION", LAYA_REVISION),
    "laya-english": (_laya("english"), "PI_ROUTER_LAYA_REVISION", LAYA_REVISION),
}


@dataclass
class Settings:
    host: str
    port: int
    device: str | None
    backends: list[str]

    @classmethod
    def from_env(cls) -> Settings:
        backends = [b.strip() for b in os.environ.get(
            "PI_ROUTER_BACKENDS", "arch-router,laya-typed-decisions").split(",") if b.strip()]
        unknown = sorted(set(backends) - set(FACTORIES))
        if unknown or not backends:
            raise SystemExit(f"PI_ROUTER_BACKENDS: unknown or empty {unknown}; choose from {sorted(FACTORIES)}")
        port = os.environ.get("PI_ROUTER_PORT", "8765")
        if not port.isdigit():
            raise SystemExit(f"PI_ROUTER_PORT must be a number, got {port!r}")
        return cls(
            host=os.environ.get("PI_ROUTER_HOST", "127.0.0.1"),
            port=int(port),
            device=os.environ.get("PI_ROUTER_DEVICE") or None,
            backends=backends,
        )


def load_backends(settings: Settings) -> dict[str, Backend]:
    loaded = {}
    for name in settings.backends:
        factory, revision_env, pinned = FACTORIES[name]
        revision = os.environ.get(revision_env) or pinned
        log.info("loading %s (revision %s)", name, revision)
        loaded[name] = factory(settings.device, revision)
    return loaded


class RouteSpec(BaseModel):
    name: str
    description: str = Field(min_length=1, max_length=400)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not ROUTE_NAME.match(v):
            raise ValueError("route names are lowercase letters, digits, '-' or '_', up to 32 characters")
        if v == OTHER:
            raise ValueError(f"'{OTHER}' is added automatically; don't define it")
        return v


class RouteRequest(BaseModel):
    task: str = Field(min_length=1, max_length=50_000)
    routes: list[RouteSpec] = Field(min_length=1, max_length=16)
    backends: list[str] | None = None  # default: every loaded backend
    greedy: bool = False

    @field_validator("routes")
    @classmethod
    def _unique(cls, v: list[RouteSpec]) -> list[RouteSpec]:
        names = [r.name for r in v]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"duplicate route names: {', '.join(dupes)}")
        return v


def create_app(backends: dict[str, Backend]) -> FastAPI:
    app = FastAPI(title="pi-router")
    # One model call at a time: the backends share one GPU and aren't documented as thread-safe.
    lock = threading.Lock()

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "backends": {
            name: {"model": b.model_id, "revision": b.revision, "device": b.device}
            for name, b in backends.items()
        }}

    # Sync handler: FastAPI runs it in a worker thread, so the event loop stays free.
    @app.post("/v1/route")
    def route(req: RouteRequest) -> dict:
        names = req.backends if req.backends is not None else list(backends)
        unknown = [n for n in names if n not in backends]
        if unknown or not names:
            raise HTTPException(400, f"unknown or empty backends {unknown}; loaded: {sorted(backends)}")
        routes = {r.name: r.description for r in req.routes}
        results: dict[str, dict] = {}
        for name in names:
            b = backends[name]
            try:
                with lock:
                    r = b.rank(req.task, routes, greedy=req.greedy)
            except Exception as e:  # one failing backend must not hide the others' answers
                log.exception("backend %s failed", name)
                results[name] = {"error": f"{type(e).__name__}: {e}"}
                continue
            results[name] = {
                "ranked": [{"route": k, "p": round(p, 4)} for k, p in r.ranked],
                "latency_ms": round(r.latency_ms, 1),
                "model": b.model_id,
                "revision": b.revision,
                **r.extra,
            }
        return {"results": results}

    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = Settings.from_env()
    app = create_app(load_backends(settings))
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


def warm() -> None:
    """Download and load every configured backend once, then run one request through each.

    The service runs with HF_HUB_OFFLINE=1 so it never downloads at startup; run this first.
    """
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    os.environ.pop("HF_HUB_OFFLINE", None)
    for name, b in load_backends(Settings.from_env()).items():
        r = b.rank("Fix the failing test in parser_test.go", {"debug": "Find the cause of a failure"})
        print(f"{name}: ok on {b.device}, revision {b.revision}, top route {r.ranked[0][0]}")

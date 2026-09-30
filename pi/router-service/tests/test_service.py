"""Service tests with fake backends: no model downloads, no GPU."""

import pytest
from fastapi.testclient import TestClient

from pi_router.backends import OTHER, Ranking
from pi_router.service import FACTORIES, Settings, create_app

ROUTES = [{"name": "debug", "description": "find a bug"}, {"name": "review", "description": "critique code"}]


class Fake:
    def __init__(self, name, ranked=None, error=None):
        self.name, self.model_id, self.revision, self.device = name, f"fake/{name}", "abc123", "cpu"
        self.ranked, self.error, self.calls = ranked, error, []

    def rank(self, task, routes, greedy=False):
        self.calls.append((task, routes, greedy))
        if self.error:
            raise self.error
        ranked = self.ranked or [(n, 1 / (len(routes) + 1)) for n in [*routes, OTHER]]
        return Ranking(ranked=ranked, latency_ms=1.23456, extra={"truncated": False})


@pytest.fixture
def fakes():
    return {"a": Fake("a", ranked=[("review", 0.8), ("debug", 0.15), (OTHER, 0.05)]), "b": Fake("b")}


@pytest.fixture
def client(fakes):
    return TestClient(create_app(fakes))


def test_health_lists_backends(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["backends"]["a"] == {"model": "fake/a", "revision": "abc123", "device": "cpu"}


def test_route_returns_every_loaded_backend(client, fakes):
    res = client.post("/v1/route", json={"task": "look at this diff", "routes": ROUTES})
    assert res.status_code == 200
    results = res.json()["results"]
    assert set(results) == {"a", "b"}
    assert results["a"]["ranked"][0] == {"route": "review", "p": 0.8}
    assert results["a"]["latency_ms"] == 1.2
    assert results["a"]["model"] == "fake/a" and results["a"]["revision"] == "abc123"
    assert results["a"]["truncated"] is False
    task, routes, greedy = fakes["a"].calls[0]
    assert task == "look at this diff" and routes == {"debug": "find a bug", "review": "critique code"}
    assert greedy is False


def test_route_selected_backend_only(client, fakes):
    res = client.post("/v1/route", json={"task": "t", "routes": ROUTES, "backends": ["b"], "greedy": True})
    assert set(res.json()["results"]) == {"b"}
    assert not fakes["a"].calls
    assert fakes["b"].calls[0][2] is True


def test_failing_backend_does_not_hide_others():
    app = create_app({"ok": Fake("ok"), "bad": Fake("bad", error=RuntimeError("MPS out of memory"))})
    results = TestClient(app).post("/v1/route", json={"task": "t", "routes": ROUTES}).json()["results"]
    assert results["bad"] == {"error": "RuntimeError: MPS out of memory"}
    assert "ranked" in results["ok"]


@pytest.mark.parametrize("body, fragment", [
    ({"task": "", "routes": ROUTES}, "task"),
    ({"task": "t", "routes": []}, "routes"),
    ({"task": "t", "routes": [ROUTES[0], ROUTES[0]]}, "duplicate route names: debug"),
    ({"task": "t", "routes": [{"name": OTHER, "description": "x"}]}, "added automatically"),
    ({"task": "t", "routes": [{"name": "Bad Name", "description": "x"}]}, "lowercase"),
    ({"task": "t", "routes": [{"name": "debug", "description": ""}]}, "description"),
])
def test_invalid_requests_are_rejected(client, body, fragment):
    res = client.post("/v1/route", json=body)
    assert res.status_code == 422
    assert fragment in res.text


def test_unknown_backend_is_rejected(client):
    res = client.post("/v1/route", json={"task": "t", "routes": ROUTES, "backends": ["nope"]})
    assert res.status_code == 400
    assert "nope" in res.text and "loaded" in res.text


def test_settings_defaults(monkeypatch):
    for var in ("PI_ROUTER_HOST", "PI_ROUTER_PORT", "PI_ROUTER_DEVICE", "PI_ROUTER_BACKENDS"):
        monkeypatch.delenv(var, raising=False)
    s = Settings.from_env()
    assert (s.host, s.port, s.device) == ("127.0.0.1", 8765, None)
    assert s.backends == ["arch-router", "laya-typed-decisions"]
    assert set(s.backends) <= set(FACTORIES)


@pytest.mark.parametrize("var, value", [("PI_ROUTER_BACKENDS", "arch-router,gpt"), ("PI_ROUTER_PORT", "80a")])
def test_settings_reject_bad_env(monkeypatch, var, value):
    monkeypatch.setenv(var, value)
    with pytest.raises(SystemExit):
        Settings.from_env()


def test_backends_load_pinned_revisions_unless_overridden(monkeypatch):
    from pi_router import service

    seen = {}
    monkeypatch.setitem(service.FACTORIES, "arch-router",
                        (lambda d, r: seen.setdefault("arch", r), "PI_ROUTER_ARCH_REVISION", "pinned"))
    settings = Settings(host="127.0.0.1", port=1, device=None, backends=["arch-router"])
    monkeypatch.delenv("PI_ROUTER_ARCH_REVISION", raising=False)
    service.load_backends(settings)
    assert seen.pop("arch") == "pinned"
    monkeypatch.setenv("PI_ROUTER_ARCH_REVISION", "override")
    service.load_backends(settings)
    assert seen["arch"] == "override"

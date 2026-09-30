# uv comes from the pi-router home-manager module; outside it, run
# `nix shell nixpkgs#uv -c make <target>`.
.PHONY: test lint warm serve spike

test:
	uv run --frozen pytest -q

lint:
	uv run --frozen --with ruff ruff check src tests

# Download and load the pinned models once; the service itself runs offline.
warm:
	uv run --frozen pi-router-warm

serve:
	uv run --frozen pi-router-serve

spike:
	uv run --frozen pi-router-spike

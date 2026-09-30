# Python and every dependency come from the root flake's `router` dev shell. Targets enter it
# automatically unless it's already active (direnv in this directory, or `nix develop`).
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
RUN := $(if $(PI_ROUTER_DEVSHELL),,nix develop $(ROOT)\#router -c)
PY := $(RUN) env PYTHONPATH=src python

.PHONY: test lint warm serve spike build

test:
	$(PY) -m pytest -q

lint:
	$(RUN) ruff check src tests

# Download and load the pinned models once; the launchd service itself runs offline.
warm:
	$(PY) -m pi_router warm

serve:
	$(PY) -m pi_router serve

spike:
	$(PY) -m pi_router spike

# The same package the launchd agent runs, including its test suite.
build:
	nix build $(ROOT)\#pi-router --no-link --print-out-paths

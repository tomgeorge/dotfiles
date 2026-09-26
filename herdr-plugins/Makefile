# Run inside the dev shell (direnv loads it from .envrc): go and
# golangci-lint aren't on the global PATH.
PLUGINS := $(patsubst %/herdr-plugin.toml,%,$(wildcard */herdr-plugin.toml))

.PHONY: all build link test test-lua test-e2e test-all lint

all: build

build: $(addprefix build-,$(PLUGINS))

# Build to a temp name and rename, so a key press mid-build never execs a
# half-written binary.
build-%:
	mkdir -p $*/bin
	go build -o $*/bin/.herdr-$*.tmp ./$*
	mv $*/bin/.herdr-$*.tmp $*/bin/herdr-$*

# Registers each plugin with Herdr (~/.config/herdr/plugins.json). Idempotent.
# A failed link is fatal: when nav isn't linked, ctrl+hjkl does nothing.
link: build
	@command -v herdr >/dev/null || { echo "herdr not installed, skipping plugin link"; exit 0; }
	@for p in $(PLUGINS); do herdr plugin link $(CURDIR)/$$p || exit 1; done

test:
	cd go-herdrkit && go test -race ./...
	go test -race ./...

# The nvim and WezTerm halves of nav (nvim/lua/nav.lua, wezterm/nav.lua).
test-lua:
	nvim --headless -u NONE -l ../nvim/tests/nav_test.lua
	nvim --headless -u NONE -l ../wezterm/nav_test.lua

# Real herdr + tmux, isolated under a temp HOME; skips if either is missing.
# HN_KEEP=1 leaves the environment running after the run, for debugging;
# -v because go test hides a passing test's log, including how to attach.
test-e2e: build
	go test -tags e2e -count=1 $(if $(HN_KEEP),-v -run TestE2E) ./nav/...

test-all: test test-lua test-e2e

lint:
	cd go-herdrkit && golangci-lint run ./...
	golangci-lint run --build-tags e2e ./...

# Run inside the dev shell (direnv loads it from the repo-root .envrc): go
# and golangci-lint aren't on the global PATH.
PLUGINS := $(patsubst %/herdr-plugin.toml,%,$(wildcard */herdr-plugin.toml))

.PHONY: all build link test test-lua test-e2e test-all lint

all: build

build: $(addprefix build-,$(PLUGINS))

# Build to a temp name and rename, so a key press mid-build never execs a
# half-written binary. The temp name is unique so concurrent builds (make
# and `herdr plugin install`, say) don't rename each other's output.
build-%:
	mkdir -p $*/bin
	tmp=$$(mktemp $*/bin/.herdr-$*.XXXXXX) && trap 'rm -f "$$tmp"' EXIT && \
		go build -o "$$tmp" ./$* && mv "$$tmp" $*/bin/herdr-$*

# Everything nav needs at runtime; idempotent. Registers each plugin with
# Herdr (~/.config/herdr/plugins.json), and puts herdr-nav where nvim looks
# for it (nvim/lua/nav.lua): without it nvim can't hand off at its edges.
# A failed link is fatal: when nav isn't linked, ctrl+hjkl does nothing.
link: build
	mkdir -p $(HOME)/.local/bin
	ln -sfn $(CURDIR)/nav/bin/herdr-nav $(HOME)/.local/bin/herdr-nav
	@command -v herdr >/dev/null || { echo "herdr not installed, skipping plugin link"; exit 0; }
	@for p in $(PLUGINS); do herdr plugin link $(CURDIR)/$$p || exit 1; done

test:
	cd go-herdrkit && go test -race ./...
	go test -race ./...

# The nvim and WezTerm halves of nav (nvim/lua/nav.lua, wezterm/nav.lua).
test-lua:
	nvim --headless -u NONE -l ../nvim/tests/nav_test.lua
	nvim --headless -u NONE -l ../wezterm/nav_test.lua

# Real herdr + tmux, isolated under a temp HOME; skips if either is missing,
# except under test-all (HN_REQUIRE=1), where a skip would hide lost coverage.
# HN_KEEP=1 leaves the environment running after the run, for debugging;
# -v because go test hides a passing test's log, including how to attach.
test-e2e: build
	go test -tags e2e -count=1 $(if $(HN_KEEP),-v -run TestE2E) ./nav/...

test-all: export HN_REQUIRE = 1
test-all: test test-lua test-e2e

lint:
	cd go-herdrkit && golangci-lint run ./...
	golangci-lint run --build-tags e2e ./...

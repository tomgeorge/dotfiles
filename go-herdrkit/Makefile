PLUGINS := $(notdir $(wildcard examples/*))

.PHONY: all build link test lint $(addprefix build-,$(PLUGINS)) $(addprefix link-,$(PLUGINS))

all: build

build: $(addprefix build-,$(PLUGINS))

# Build to a temp name and rename, so a key press mid-build never execs a
# half-written binary.
$(addprefix build-,$(PLUGINS)): build-%:
	mkdir -p examples/$*/bin
	go build -o examples/$*/bin/.herdr-$*.tmp ./examples/$*
	mv examples/$*/bin/.herdr-$*.tmp examples/$*/bin/herdr-$*

# Registers the plugin with Herdr (~/.config/herdr/plugins.json). Idempotent.
link: $(addprefix link-,$(PLUGINS))

$(addprefix link-,$(PLUGINS)): link-%: build-%
	herdr plugin link $(CURDIR)/examples/$*

test:
	go test -race ./...

lint:
	golangci-lint run ./...

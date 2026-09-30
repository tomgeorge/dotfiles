# Run from anywhere in the repo; the dev shell (.envrc) covers the whole tree.
# Targets forward to herdr-plugins/Makefile.
.PHONY: all build link test test-lua test-e2e test-all lint

all build link test test-lua test-e2e test-all lint:
	$(MAKE) -C herdr-plugins $@

build-%:
	$(MAKE) -C herdr-plugins $@

# pi/router-service targets: make router-test, router-warm, router-lint, ...
router-%:
	$(MAKE) -C pi/router-service $*

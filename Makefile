GRUNT      := flock node_modules/.quirk-build.lock node_modules/.bin/grunt
CHROME_BIN ?= $(shell command -v chromium || command -v google-chrome-stable || command -v google-chrome)
export CHROME_BIN

OUT := out/quirk.html
BROWSER ?= $(shell command -v chromium || command -v google-chrome-stable || command -v xdg-open)

.DEFAULT_GOAL := help
.PHONY: help install build debug run open test test-chrome test-page perf clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

node_modules: package-lock.json
	PUPPETEER_SKIP_DOWNLOAD=1 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 npm ci --no-audit --no-fund
	@touch node_modules

install: node_modules

build: node_modules
	$(GRUNT) build-src

debug: node_modules
	$(GRUNT) build-debug

run: build open

open:
	@test -f $(OUT) || { echo "$(OUT) missing, run 'make build' first"; exit 1; }
	nohup $(BROWSER) "file://$(CURDIR)/$(OUT)" >/dev/null 2>&1 &

test: test-chrome

test-chrome: node_modules
	$(GRUNT) test-chrome

test-page: node_modules
	$(GRUNT) build-test-page

perf: node_modules
	$(GRUNT) test-perf-chrome

clean:
	rm -rf out

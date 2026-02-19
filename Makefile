# Makefile for StudioLive MIDI Controller

.PHONY: help build clean dev start dist dist-mac dist-win dist-all install typecheck copy-assets rebuild install-deps build-deps

# Paths
DEPS_DIR = ../presonus-studiolive-api

# Default target
.DEFAULT_GOAL := help

help: ## Show this help message
	@echo "StudioLive MIDI Controller - Available targets:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install-deps: ## Install dependencies in the dependent repo
	@if [ -d "$(DEPS_DIR)" ]; then \
		echo "Installing dependencies in $(DEPS_DIR)..."; \
		cd $(DEPS_DIR) && npm install; \
	else \
		echo "Warning: Dependent repo not found at $(DEPS_DIR)"; \
		exit 1; \
	fi

build-deps: install-deps ## Build the dependent repo
	@echo "Building dependent repo..."
	@cd $(DEPS_DIR) && npm run build

install: install-deps build-deps ## Install and link dependencies
	npm install

build: clean copy-assets ## Build the application
	tsc -p tsconfig.main.json

copy-assets: ## Copy assets to dist directory
	mkdir -p dist/renderer
	cp src/renderer/index.html dist/renderer/

clean: ## Clean build artifacts
	rm -rf dist

rebuild: clean build ## Clean and rebuild

dev: build ## Build and run in development mode
	npm run dev

start: ## Start the application (requires prior build)
	npm start

dist: dist-mac ## Build distributable packages (default: macOS)

dist-mac: build ## Build macOS packages (DMG and ZIP for x64 and arm64)
	@echo "Building macOS packages..."
	npm run dist -- --mac

dist-win: build ## Build Windows packages (NSIS installer and portable)
	@echo "Building Windows packages..."
	npm run dist -- --win

dist-all: build ## Build packages for all platforms
	@echo "Building packages for all platforms..."
	npm run dist -- --mac --win

typecheck: ## Run TypeScript type checking without building
	tsc -p tsconfig.main.json --noEmit


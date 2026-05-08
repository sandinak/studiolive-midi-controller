# Makefile for StudioLive MIDI Controller

.PHONY: help build clean dev start dist dist-mac dist-win dist-all install setup typecheck copy-assets rebuild install-deps build-deps test release

# Paths
DEPS_DIR  = ../presonus-studiolive-api
APP_NAME  = StudioLive MIDI Controller

# Detect local architecture for install target
UNAME_M  := $(shell uname -m)
ifeq ($(UNAME_M),arm64)
  RELEASE_APP_DIR = release/mac-arm64
else
  RELEASE_APP_DIR = release/mac
endif

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

setup: install-deps build-deps ## Install and link all dependencies (dev setup)
	npm install

install: setup build ## Build and install app to /Applications
	@echo "Building app bundle for $(UNAME_M)..."
	CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir
	@rm -rf "/Applications/$(APP_NAME).app"
	cp -r "$(RELEASE_APP_DIR)/$(APP_NAME).app" "/Applications/$(APP_NAME).app"
	@echo "Installed: /Applications/$(APP_NAME).app"

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

dist-mac: build ## Build macOS DMG — loads .env for signing/notarization if present
	@echo "Building macOS packages..."
	@echo "  Replacing file: symlink with real package dir for electron-builder..."
	@rm -rf node_modules/presonus-studiolive-api
	@mkdir -p node_modules/presonus-studiolive-api
	@cp -r $(DEPS_DIR)/dist node_modules/presonus-studiolive-api/
	@cp $(DEPS_DIR)/package.json node_modules/presonus-studiolive-api/
	@if [ -d $(DEPS_DIR)/node_modules ]; then \
		cp -r $(DEPS_DIR)/node_modules node_modules/presonus-studiolive-api/; \
	fi
	@if [ -f .env ]; then \
		echo "  Loading Apple credentials from .env for notarization..."; \
		set -a && . ./.env && set +a && NODE_OPTIONS=--max-old-space-size=8192 npm run dist -- --mac; \
	else \
		echo "  ⚠ WARNING: No .env found — building UNSIGNED (use 'make release' for signed builds)"; \
		echo "  ⚠ This build should NOT be distributed to users"; \
		NODE_OPTIONS=--max-old-space-size=8192 npm run dist -- --mac; \
	fi
	@echo "Restoring dev symlink and native modules..."
	npm install --ignore-scripts=false

dist-win: build ## Build Windows packages (NSIS installer and portable)
	@echo "Building Windows packages..."
	npm run dist -- --win

dist-all: build ## Build packages for all platforms
	@echo "Building packages for all platforms..."
	@if [ -f .env ]; then \
		set -a && . ./.env && set +a && NODE_OPTIONS=--max-old-space-size=8192 npm run dist -- --mac --win; \
	else \
		NODE_OPTIONS=--max-old-space-size=8192 npm run dist -- --mac --win; \
	fi

typecheck: ## Run TypeScript type checking without building
	tsc -p tsconfig.main.json --noEmit

test: ## Run Jest unit tests
	npm test

# ---------------------------------------------------------------------------
# Release pipeline — build, test, sign, and push
# ---------------------------------------------------------------------------
release: ## Full release: typecheck, test, build signed packages, and push tag
	@echo ""
	@echo "���═════════════════════════════════════════════════════════"
	@echo "  Release pipeline — $(shell node -p "require('./package.json').version")"
	@echo "══════════════════════════════════════════════════════════"
	@echo ""
	@# --- Pre-flight checks ---
	@echo "▶ [1/7] Pre-flight checks..."
	@if [ ! -f .env ]; then \
		echo "  ✗ ERROR: .env file not found — signing credentials required for release"; \
		echo "    Create .env with APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID"; \
		exit 1; \
	fi
	@for var in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do \
		if ! grep -q "$$var" .env; then \
			echo "  ✗ ERROR: $$var missing from .env — all signing credentials required for release"; \
			echo "    Required: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID"; \
			exit 1; \
		fi; \
	done
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "  ✗ ERROR: Working tree is dirty — commit or stash changes before releasing"; \
		git status --short; \
		exit 1; \
	fi
	@echo "  ✓ .env present with all signing credentials"
	@echo "  ✓ Working tree is clean"
	@echo ""
	@# --- TypeScript type check ---
	@echo "▶ [2/7] TypeScript type check..."
	@$(MAKE) typecheck
	@echo "  ✓ Type check passed"
	@echo ""
	@# --- Run tests ---
	@echo "▶ [3/7] Running tests..."
	@npm test
	@echo "  ✓ All tests passed"
	@echo ""
	@# --- Build signed packages ---
	@echo "▶ [4/7] Building signed macOS packages..."
	@$(MAKE) dist-mac
	@echo "  ✓ Signed macOS packages built"
	@echo ""
	@# --- Verify code signature ---
	@echo "▶ [5/7] Verifying code signature..."
	@APP=$$(find release/mac* -name '*.app' -maxdepth 2 | head -1); \
	if [ -z "$$APP" ]; then \
		echo "  ✗ ERROR: No .app bundle found in release/ — build may have failed"; \
		exit 1; \
	fi; \
	if ! codesign --verify --deep --strict "$$APP" 2>/dev/null; then \
		echo "  ✗ ERROR: Code signature verification FAILED on $$APP"; \
		echo "    This release would be unsigned — aborting to prevent another v1.3.1 incident"; \
		exit 1; \
	fi; \
	TEAM=$$(codesign -dv "$$APP" 2>&1 | grep TeamIdentifier | cut -d= -f2); \
	echo "  ✓ Code signature valid (Team: $$TEAM)"
	@echo ""
	@# --- Tag the release ---
	@echo "▶ [6/7] Tagging release..."
	@VERSION=$$(node -p "require('./package.json').version"); \
	if git rev-parse "v$$VERSION" >/dev/null 2>&1; then \
		echo "  ⚠ Tag v$$VERSION already exists — skipping tag creation"; \
	else \
		git tag -a "v$$VERSION" -m "Release v$$VERSION"; \
		echo "  ✓ Created tag v$$VERSION"; \
	fi
	@echo ""
	@# --- Push ---
	@echo "▶ [7/7] Pushing to remote..."
	@VERSION=$$(node -p "require('./package.json').version"); \
	git push && git push origin "v$$VERSION"
	@echo "  ✓ Pushed branch and tag"
	@echo ""
	@echo "══════════════════════════════════════════════════════════"
	@echo "  ✓ Release v$$(node -p "require('./package.json').version") complete!"
	@echo "══════════════════════════════════════════════════════════"

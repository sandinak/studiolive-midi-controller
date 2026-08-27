# Building StudioLive MIDI Controller

This document describes how to build distributable packages for macOS, Windows, and Linux.

## Prerequisites

- Node.js 22+ and npm — the upstream `presonus-studiolive-api` build imports
  `styleText` from `node:util`, which Node 18 doesn't provide
- Python 3.11 — `node-gyp` needs `distutils` to compile the native MIDI
  module, and Python 3.12 removed it (anything older than 3.12 works)
- yarn on `PATH` (`corepack enable`) — the pinned `presonus-studiolive-api`
  dependency runs its own build during install, and that build shells out to
  yarn. GitHub's x64 runner images ship it; a bare Debian box does not
- For macOS builds: macOS with Xcode Command Line Tools
- For Windows builds: Windows or macOS (cross-compilation supported)
- For Linux builds: `fakeroot` and `dpkg` for the `.deb` target (which is the only
  target that needs a Linux host); `libasound2-dev` only if the prebuilt MIDI
  binaries are ever unavailable and the module has to compile from source

## Quick Start

### Build for Current Platform

```bash
# Build for macOS (DMG and ZIP)
make dist-mac

# Build for Windows (NSIS installer and portable)
make dist-win

# Build for Linux (AppImage, .deb, tar.gz)
make dist-linux

# Build for all platforms
make dist-all
```

## Build Targets

### macOS Packages

```bash
make dist-mac
```

This creates:
- **DMG installer** (`release/StudioLive MIDI Controller-{version}.dmg`)
  - Universal binary (x64 and arm64)
  - Drag-and-drop installation
  - Includes Applications folder shortcut
  
- **ZIP archive** (`release/StudioLive MIDI Controller-{version}-mac.zip`)
  - Universal binary (x64 and arm64)
  - For manual installation or distribution

### Linux Packages

```bash
make dist-linux
```

This creates, for both x64 and arm64:
- **AppImage** (`release/StudioLive MIDI Controller-{version}.AppImage`,
  and `-{version}-arm64.AppImage`)
  - Self-contained; `chmod +x` and run, no installation
- **Debian package** (`release/studiolive-midi-controller_{version}_amd64.deb`)
  - Declares ALSA and the usual Electron runtime libraries, each as a
    `pkg | pkgt64` alternative so it installs on both sides of the Debian
    `time_t` transition (Ubuntu 24.04 / Debian 13 renamed `libasound2` to
    `libasound2t64`)
- **Tarball** (`release/studiolive-midi-controller-{version}.tar.gz`)
  - For distro packaging or manual placement

**Nothing is compiled during a Linux build**, which is why one host produces
both architectures. Electron is downloaded prebuilt, and `@julusian/midi` — the
only native dependency that ships — is a
[prebuildify](https://github.com/prebuild/prebuildify) package whose tarball
already contains `linux-x64`, `linux-arm64`, `linux-arm`, and musl binaries. So
`--x64` and `--arm64` both work from an x64 Linux box, and from macOS too.

The one host requirement is the `.deb`: electron-builder shells out to
`fakeroot` and `dpkg-deb` to assemble it, so that target needs Linux.
AppImage and tar.gz do not.

The `.deb` also needs packaging metadata the other targets do not: a top-level
`homepage` in `package.json`, and `build.linux.maintainer`. The maintainer is
set to `sandinak <sandinak@users.noreply.github.com>` — deliberately the GitHub
noreply form, since that string is embedded in every published `.deb`. Change it
there if you would rather ship a different contact address.

`build-linux` in `.github/workflows/release.yml` therefore runs a single
`ubuntu-22.04` job emitting both architectures. 22.04 rather than
`ubuntu-latest` is habit rather than necessity here — since nothing links
against the runner's glibc, the artifacts are portable either way — but it
keeps the toolchain matched to the oldest distro the app targets.

MIDI on Linux goes through ALSA. Users need `libasound2` present (the `.deb`
depends on it; AppImage users on a minimal system may have to install it), and
the mixer connection itself is plain TCP/UDP, so nothing else is platform-specific.

### Windows Packages

```bash
make dist-win
```

This creates:
- **NSIS Installer** (`release/StudioLive MIDI Controller Setup {version}.exe`)
  - x64 architecture
  - Customizable installation directory
  - Desktop and Start Menu shortcuts
  - Uninstaller included
  
- **Portable Executable** (`release/StudioLive MIDI Controller {version}.exe`)
  - x64 architecture
  - No installation required
  - Run directly from any location

### All Platforms

```bash
make dist-all
```

Builds packages for both macOS and Windows.

## Build Output

All packages are created in the `release/` directory. `<version>` is whatever
`package.json` currently declares; macOS produces a separate artifact per
architecture rather than a universal binary:

```
release/
├── StudioLive MIDI Controller-<version>.dmg               # macOS DMG (x64)
├── StudioLive MIDI Controller-<version>-arm64.dmg         # macOS DMG (Apple silicon)
├── StudioLive MIDI Controller-<version>-mac.zip           # macOS ZIP (x64)
├── StudioLive MIDI Controller-<version>-arm64-mac.zip     # macOS ZIP (Apple silicon)
├── StudioLive MIDI Controller Setup <version>.exe         # Windows installer
└── StudioLive MIDI Controller <version>.exe               # Windows portable
```

## Build Process

The build process consists of:

1. **Clean** - Remove previous build artifacts
2. **Copy Assets** - Copy HTML and other assets to `dist/`
3. **Compile TypeScript** - Compile `.ts` files to `.js` in `dist/`
4. **Package** - Use electron-builder to create installers

## Configuration

Build configuration is in `package.json` under the `build` key:

- **appId**: `com.sandinak.studiolive-midi-controller`
- **productName**: `StudioLive MIDI Controller`
- **macOS**: DMG and ZIP for x64 and arm64
- **Windows**: NSIS installer and portable for x64

## Custom Icons

To add custom application icons, see `assets/README.txt` for instructions.

Icons are optional - the application will build successfully with default Electron icons.

## Troubleshooting

### macOS Code Signing

If you encounter code signing issues on macOS:

```bash
# Build without code signing (for testing)
CSC_IDENTITY_AUTO_DISCOVERY=false make dist-mac
```

For distribution, you'll need an Apple Developer certificate.

### Windows Build on macOS

Windows builds can be created on macOS using Wine:

```bash
# Install Wine (if not already installed)
brew install --cask wine-stable

# Build Windows packages
make dist-win
```

### Build Fails with "Cannot find module"

Ensure dependencies are installed:

```bash
make install
```

## Development Workflow

```bash
# Install dependencies
make install

# Build and run in development mode
make dev

# Build for production
make build

# Create distributable packages
make dist-mac
```

## Version Management

Update version in `package.json`:

```json
{
  "version": "0.9.0"
}
```

The version number is automatically included in package filenames.

## Additional Make Targets

- `make help` - Show all available targets
- `make build` - Build the application (no packaging)
- `make clean` - Remove build artifacts
- `make rebuild` - Clean and rebuild
- `make typecheck` - Run TypeScript type checking



## Screenshots

`docs/images/*.png` is generated, not hand-captured:

```bash
make shots                      # every scene
npm run shots -- mapping-modal  # one scene
```

The harness in [`tools/screenshot/`](../tools/screenshot/) loads the real
renderer (`dist/renderer/index.html`) with a preload that answers every IPC
channel from a fixture board instead of a console. No mixer, MIDI interface, or
network is touched, so it produces identical images on macOS, Windows, or a
headless Linux runner under `xvfb-run` — which is exactly what the `screenshots`
job in `.github/workflows/ci.yml` does on every push, doubling as a smoke test
that the UI still renders.

On Linux the harness must be launched through `tools/screenshot/run.js` — what
`make shots` and `npm run shots` do — not by invoking `electron main.js`
directly. Electron validates the SUID sandbox helper during startup, before any
switch the app sets itself is read, so `--no-sandbox` has to arrive as a real
command-line argument. Skip the launcher and it dies with SIGTRAP; worse, the
failure sometimes surfaces first as `Creating shared memory in /dev/shm/...
failed: No such process`, which sends you chasing `/dev/shm` permissions that
were never the problem. Verified working under `xvfb-run` on both a GitHub
runner and an unprivileged Proxmox LXC container.

To add a shot, append an entry to `tools/screenshot/scenes.js`: a `name` (which
becomes the filename), an optional `setup` snippet run inside the renderer to
open a dialog or change a mode, and an optional `clip` selector to crop to one
element. To change what the fixture mixer looks like — channel names, icons,
colours, DCA membership, mappings — edit `tools/screenshot/fixtures.js`.

Nothing under `tools/` ships: electron-builder's `files` list only packages
`dist/`, `package.json`, `CHANGELOG.md`, and `docs/`.

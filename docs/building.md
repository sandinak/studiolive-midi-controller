# Building StudioLive MIDI Controller

This document describes how to build distributable packages for macOS and Windows.

## Prerequisites

- Node.js 18+ and npm
- For macOS builds: macOS with Xcode Command Line Tools
- For Windows builds: Windows or macOS (cross-compilation supported)

## Quick Start

### Build for Current Platform

```bash
# Build for macOS (DMG and ZIP)
make dist-mac

# Build for Windows (NSIS installer and portable)
make dist-win

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

All packages are created in the `release/` directory:

```
release/
├── StudioLive MIDI Controller-0.9.0.dmg              # macOS DMG (universal)
├── StudioLive MIDI Controller-0.9.0-mac.zip          # macOS ZIP (universal)
├── StudioLive MIDI Controller Setup 0.9.0.exe        # Windows installer
└── StudioLive MIDI Controller 0.9.0.exe              # Windows portable
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


# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-21

### Added
- Stereo-linked fader support — paired channels move together in the UI
- Persistent auto-reconnection for MIDI (3 s) and mixer (10 s)
- Quit confirmation dialog
- Connection status log entries for MIDI and mixer connect/reconnect
- Mute group support with real-time state polling
- DCA level polling for responsive fader tracking
- Filter modes: DCA groups and auto-filter groups
- Channel colors and icons from mixer configuration

### Changed
- Reorganized documentation: simplified README, added docs/setup.md and docs/usage.md
- Removed all debug console.log output from main and renderer processes
- Fixed channel count calculation to read from zlibData instead of partially-populated cache
- Fixed phantom mapping entries — clearing a mapping now fully removes it
- Improved MIDI-to-mixer command error handling (silent failures instead of noisy logs)

### Fixed
- Right-side stereo fader not updating when DCA moves (fader-value element not required)
- EPIPE errors from console.log in renderer process
- Stereo link check incorrectly applied to DCA channels
- Channel counts reported incorrectly due to early ParamValue messages

## [0.9.0] - 2026-02-19

### Added
- Makefile for streamlined build and development workflow
- BUILD.md documentation for creating distributable packages
- Support for building DMG installers for macOS (x64 and arm64)
- Support for building Windows installers (NSIS and portable)
- Comprehensive build targets for development and distribution

### Changed
- Updated README.md with correct attribution for presonus-studiolive-api library
- Improved project structure and build process

### Security
- Fixed minimatch ReDoS vulnerability (CVE-2026-26996) in presonus-studiolive-api dependency
- Contributed security fix upstream via PR #60

### Fixed
- Resolved 6 high severity vulnerabilities in dependency chain

---

[1.0.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.0.0
[0.9.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v0.9.0


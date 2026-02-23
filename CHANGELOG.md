# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-02-22

### Fixed
- Discovery: source-port filter now rejects packets not originating from port 47809, preventing non-mixer devices (DAW plugins, Universal Control, other app instances) from appearing in the discover list
- Discovery: local IP list refreshed on every packet instead of once at setup time, so VPN connections and dynamic interface changes no longer produce stale filter entries
- Default preset cleaned up — ships with empty mixer IP, no MIDI devices, and no mappings

## [1.2.0] - 2026-02-22

### Added
- Per-MIDI-device color coding — assign a color to each MIDI device; color badges appear on mapped channel faders
- Channel level display preference: **None**, **Indicator** (colored dot), or **Meter** (vertical VU bar with real audio levels via UDP meter stream)
- Peak hold option for meter mode (3-second hold, white marker line)
- DCA channels no longer show the Main assign button (DCAs do not route to Main mix)
- Larger channel icons (increased from 1.2 rem to 1.6 rem for better readability)
- `Cmd-S` / `Ctrl-S` keyboard shortcut for quick-save to current preset path
- Mappings list modal showing all mappings in a table with edit and delete actions
- Proactive MIDI device disconnect detection via 2-second background poll
- Mixer disconnect detection via TCP connection `closed` event — striped warning appears immediately on the mixer button
- Prompt when manually disconnecting a MIDI device: option to clear all mappings for that device
- Status log entries for all MIDI and mixer connect/disconnect events
- Docs button now checks live website first and falls back to bundled docs when offline

### Changed
- Mixer auto-reconnect interval reduced from 10 s to 3 s
- Fader borders show dashed pulsing red/white animation when a mapped MIDI device is missing
- Mixer and MIDI connection buttons show striped red/black background when the respective device is disconnected (but was previously configured)
- MIDI device color picker updates fader borders in real-time

### Fixed
- `midi-device-lost` and `mixer-lost` IPC push events were missing from preload whitelist — renderer never received them
- `save-preset-to-path` IPC invoke missing from preload whitelist — `Cmd-S` quick-save was silently broken
- `currentMappingsList`, `returnToMappingsList`, `midiLearnActive` declared after first use causing temporal dead zone errors when opening the mappings list or clearing a mapping
- First connect not delivering mixer data — redundant `connect-mixer` call during startup triggered the duplicate `mixer-state-ready` guard and skipped channel load

## [1.1.0] - 2026-02-21

### Added
- Multi-device MIDI input support — connect and use multiple MIDI devices simultaneously
- MIDI Learn mode — press **Learn** in the mapping dialog and move any control to auto-detect device, channel, and CC/note
- MIDI device filter on fader view — show only channels mapped to a specific device
- Preferred MIDI devices list persisted in preset
- Comprehensive test suite (Jest) covering mapping engine, MIDI manager, and mixer manager
- Security hardening: preload `contextBridge` whitelist for all IPC channels

### Changed
- MIDI connection panel redesigned to support multiple concurrent device connections
- Mapping form now shows device name alongside CC/channel info

### Fixed
- Duplicate MIDI messages when scanning already-open ports on macOS CoreMIDI
- MIDI feedback sent to correct device output when multiple devices connected

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

[1.2.1]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.2.1
[1.2.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.2.0
[1.1.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.1.0
[1.0.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.0.0
[0.9.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v0.9.0

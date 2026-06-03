# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-06-03

### Fixed
- **CI release workflow** — bumped GitHub Actions `node-version` from 18 → 22 in `.github/workflows/release.yml`. Node 18 lacks `styleText` in `node:util`, which the upstream `presonus-studiolive-api` build pipeline (rolldown/tsdown) now imports, causing both the macOS and Windows CI jobs to fail. v1.4.0 and v1.4.1 both hit this and shipped without a CI-built Windows artifact; v1.4.2's CI pipeline now produces the full Mac + Windows release.

## [1.4.1] - 2026-05-13

### Fixed
- **Startup crash on macOS** — `Cannot create BrowserWindow before app is ready`. The `activate` handler could fire before `app.whenReady()` resolved (e.g. when launched from the dock), constructing a `BrowserWindow` too early. The handler now early-returns until `app.isReady()`.

## [1.4.0] - 2026-05-08

### Added
- **Active TCP subnet sweep discovery** — UDP broadcast (port 47809) gets blocked by PreSonus Universal Control on macOS, so discovery now also TCP-probes every host on local /22-or-smaller subnets for port 53000. Probes are prioritized to interfaces containing the saved mixer IP first; bare TCP hits are then enriched by a brief SimpleClient connect to read model/name/serial.
- **Manual mixer probe** — new `probe-mixer-ip` and `identify-mixer-ip` IPC handlers let the Find Mixer dialog directly check a typed-in or saved IP without waiting for broadcast discovery.
- **Per-mixer presets** — on connect, the app compares the connected mixer to the one the preset was built for (serial first, then model + IP fallback). On mismatch, you can spin up a fresh preset for the new mixer (`check-mixer-match` + `create-preset-for-mixer`).
- **Fader stacking** — preset option to wrap faders into 2 compact rows when channel count exceeds 16.
- **Per-channel input source** — select Analog / Network / USB / SD Card per channel via `set-channel-input-source`.
- **Channel counts query** — `get-channel-counts` exposes the mixer's actual channel layout to the renderer.
- **`make release` pipeline** — single command runs pre-flight checks (`.env` signing credentials, clean working tree), typecheck, tests, signed `dist-mac`, codesign verification, tag, and push.
- **Five new test suites** — channel-routing, fader-stacking, mixer-match, preload-allowlist, plus a `tests/integration/` framework with `midi-to-mixer.test.ts`.

### Fixed
- **`isConnected()` could lie** during an in-flight TCP timeout or after the remote dropped us — now gated on a `handshakeComplete` flag that flips true only after `client.connect()` resolves.
- **Failed `connect()` left a partial client** behind (stuck "connected" UI, latched reconnect guard) — now fully torn down on error.
- **Remote-side disconnect** (mixer powered off, network loss) now tears down state and emits `disconnected` with the IP, letting the reconnect loop take over.
- **mute / solo / lr / link could arrive as a raw Buffer** from the API and read as always-truthy in the renderer — normalized via `normalizeBoolish()` on both event emit and PV/PS/PC packet paths.
- **Mute group toggle always sent "on"** because the state read it relied on was sometimes stale or null on real firmware — now tracks commanded state locally and alternates correctly. Polling and PV packets sync the commanded cache when external sources (mixer console, Universal Control) change the group.
- **Mute group changes from external sources** now arrive instantly via PV packets instead of waiting on the 200ms poll.

### Changed
- Test mock for `presonus-studiolive-api` now normalizes `/` → `.` paths (matches real KVTree behavior) — caught a real `getMuteGroupState()` path-format bug.
- `make dist-mac` warns more loudly when no `.env` is present, since unsigned builds shouldn't be distributed.

## [1.3.0] - 2026-03-26

### Fixed
- **App stuck on "Initializing"** — race condition between `mixer-state-ready` event and renderer initialization; added 5-second fallback timer
- **Reconnection failure** — 15-second dedup guard on `mixer-state-ready` not reset on disconnect; fixed by resetting in `mixer-lost` handler
- **DCA color picker not applying** — global `mousedown` handler intercepted color swatch clicks; fixed by protecting `dca-color-menu` from `hideAllContextMenus()`
- **Mute group toggle not updating channel mute buttons** — `getMuteGroupState()` used slash path but state map uses dot path; also fixed stale state reads by setting mute state directly from group state
- **Solo button visible on MAIN/DCA faders** — hidden with alignment-preserving placeholder

### Added
- **Real-time property sync from Universal Control** — color, name, icon, mute, solo, and link changes from the mixer console or Universal Control now update the app in real-time via PV/PS/PC packet listeners
- **Brighter DCA badge text** — badge text colors lightened 35% toward white for improved readability on dark backgrounds
- **Cmd+S status bar update** — saving now updates the "last saved" timestamp in the status bar

### Changed
- Removed debug `console.log` noise from mute group and discovery code

## [1.2.4] - 2026-03-05

### Added
- **Run/Edit mode toggle** — header button switches between Edit mode (full access) and Run mode (mixing controls active, mapping/editing locked)
  - In Run mode: faders and mute buttons work normally; solo buttons hidden with mute expanding to fill the gap; mute groups fully active; add/edit actions blocked
  - New **Start in Run mode** preference to launch directly in Run mode
- **Transport Play/Stop button** — visible in Run mode; sends MIDI real-time Start (`0xFA`) / Stop (`0xFC`) to all connected MIDI outputs for DAW transport control (Logic Pro and others)

### Changed
- **MAIN fader** now has a distinct dark green background and border, visually separating it from DCA/SUB/AUX channels in the main section
- **Main-assign indicator** color updated from tan to muted green, consistent with the MAIN fader theme
- Main section left border updated to green to reinforce the visual language

## [1.2.2] - 2026-02-22

### Added
- Input source icons enlarged from 16×16 to 20×20 px for improved readability
- Comprehensive test coverage: 192 tests covering all v1.2.x settings methods, channel getters, mute group methods, meter subscribe error path, and progressive discovery
- Discovery: local-IP filter in `discoverProgressive` prevents the app from mistakenly connecting to itself on multi-homed systems

### Changed
- Version update check now queries both `/releases/latest` and `/tags` APIs in parallel — unreleased git tags are detected as available updates
- Clicking the version badge in the status bar now opens the local changelog instead of the update modal
- Logic Pro documentation updated: uses **Logic Pro Virtual Out** (Logic's built-in CoreMIDI port) directly — no IAC Driver setup required
- Future-features: removed **Channel Level Meters** (shipped in v1.2.0) and **Cmd-S** shortcut (shipped in v1.2.0)

### Fixed
- Discovery: reverted upstream `Discovery.ts` change that incorrectly overrode `rinfo.address` with a packet-embedded IP, causing wrong mixer IPs to be reported on networks with multiple interfaces
- Save dialog: default path now correctly resolves to `~/Library/Application Support/StudioLive Midi Controller/` (was `~/Library/Application Preferences/…/profiles/`)
- Status bar version stuck at `1.1.0` when preferred mixer auto-connected on startup (version fetch was unreachable behind early-return path)
- `getMixerSerial` not cleared on disconnect — could return stale serial after reconnecting to a different mixer
- TypeScript: fixed `DiscoveryType` property access (`model` → `name`, removed undefined `deviceName`) in auto-connect path

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

[1.3.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.3.0
[1.2.4]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.2.4
[1.2.2]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.2.2
[1.2.1]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.2.1
[1.2.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.2.0
[1.1.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.1.0
[1.0.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v1.0.0
[0.9.0]: https://github.com/sandinak/studiolive-midi-controller/releases/tag/v0.9.0

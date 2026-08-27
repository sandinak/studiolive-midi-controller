# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Channel labels truncated on Linux.** The default Linux sans is wider than the macOS system font, so fader name and mapping badges that fit on a Mac ("Snare Top", "Playback L", "CC21 Ch1") ellipsized there by 1-5px. `fitFaderLabels()` now steps the font size down one notch for the badges that actually overflow, on any platform — which also helps the long channel names a console can hand back. Labels that are genuinely too long still ellipsize rather than shrink into illegibility. Reads are batched ahead of the writes, so the common case of nothing overflowing costs a single layout pass.

### Added
- **The annotated main-window screenshot is generated too.** Scenes can now declare numbered callout badges (`annotate:` in `tools/screenshot/scenes.js`), drawn into the page before capture. `main-window-annotated.png` had been hand-annotated at v1.1.0 and drifted six versions behind the UI it described, with callout numbers that no longer matched the legend beside it on the docs site. Both are now in step, and the legend text was corrected to describe what those regions actually contain.
- **Documented the yarn build requirement.** The pinned `presonus-studiolive-api` dependency builds itself during `npm install` and its build script invokes yarn, so a machine without it fails `npm ci` with `sh: 1: yarn: not found`. GitHub's x64 runner images happen to ship yarn, which is why this never surfaced in CI. Now called out in the README and both setup docs, and made explicit with `corepack enable` in the Linux CI jobs.
- **Linux builds.** electron-builder now produces an AppImage, a `.deb`, and a tarball for x64 and arm64, via `make dist-linux` or the new `build-linux` job in the release workflow. A single x64 host emits both architectures: nothing is compiled during a Linux build, because Electron is downloaded prebuilt and `@julusian/midi` — the only native dependency that ships — is a prebuildify package carrying `linux-x64`, `linux-arm64`, and musl binaries in its tarball. The `.deb` is the one target that needs a Linux host, since electron-builder shells out to `fakeroot`/`dpkg-deb`; it declares ALSA as a `libasound2 | libasound2t64` alternative so it installs on both sides of the Debian `time_t` transition. No main-process changes were needed — the platform branches for icon path, dock icon, and `window-all-closed` already handled non-macOS. Verified end to end on a Debian 11 host. Building the `.deb` also required packaging metadata the project never had: a top-level `homepage`, and a `linux.maintainer` (set to the GitHub noreply address rather than a personal one, since it is published inside every `.deb`).
- **Documentation screenshot harness** (`make shots`, `npm run shots`). Boots the real renderer against a fixture mixer defined in `tools/screenshot/fixtures.js` — a full 16-channel board with names, icons, colors, stereo links, DCA and mute-group membership, and a representative mapping set — then drives it through the scenes in `tools/screenshot/scenes.js` and writes `docs/images/*.png`. No mixer, MIDI interface, or network involved, so it reproduces on any platform. A `screenshots` job in CI runs it headlessly under `xvfb-run` on every push and attaches the images to the run, which doubles as a smoke test that the UI still renders.
- **README screenshots.** The README now shows the main window, a channel strip close-up, the mute-group bar, the mapping dialog, the mappings list, and the discovery and MIDI dialogs. The previous `docs/images/` set was captured at v1.2.0 and predated the v1.7.0 fader restyle and instrument icons; everything except the hand-annotated `main-window-annotated.png` is regenerated.

## [1.7.0] - 2026-07-24

### Added
- **SVG instrument icons.** Stroked line-icons for the common instrument families (guitar, bass, keys, drums, mic, headphones, strings, winds, brass, FX, and more) now render in place of the emoji set, mapped from the mixer's channel icon IDs. Any family without a line-icon falls back to the existing emoji, so nothing regresses.
- **Soak / leak / throughput test harness.** A headless, mock-driven suite (`npm run test:soak`, `make soak`) that exercises the failure modes only a long live session reveals — reconnect churn, MIDI replug, MIDI-learn scan churn, the translate hot path, and the unauthenticated-UDP TUIO parser — asserting pollers clear, maps drain, listeners stay steady, handles stay flat, and heap stays bounded. Includes a self-reporting multi-hour endurance mode; a 9-hour run held heap flat at ~123 MB (+0.03 MB/hr) across 14.3 billion translate calls and 11.4 million mixer reconnect cycles with zero issues.

### Changed
- **Fader restyle.** Fader channels get a gradient background, a subtle border, and a hover state; the mono fader track is narrower so it reads as a single stereo bar.

### Fixed
- **Uncaught exception could crash the main process.** The volume-throttle timer callback ran outside the MIDI message handler's try/catch and called `setVolume()`, which throws synchronously when the mixer has disconnected mid-throttle. It now checks the connection and catches — a fader move landing in the ~25 ms window as the mixer drops can no longer take down the app.
- **Main-assign state could read as always-on.** `getChannelMainAssign` used `Boolean(lr)`, which is always true for a pass-through `Buffer`. It now decodes the float like the mute/solo/link getters and compares `> 0`.
- **Redundant mute-group polling.** The 200 ms mute-group poll now stops once a PV mute-group packet proves the mixer's push path works (re-armed on each reconnect), removing idle polling without regressing external-change display on firmware that lacks those packets.

### Developer
- The post-handshake state-settle delay is injectable (`stateSettleMs`), letting the mixer-manager and channel-routing test suites skip the real 500 ms wait — the full unit suite drops from ~33 s to ~4 s. Default `npm test` ignores `tests/soak`; `soak-results/` is gitignored.

## [1.6.0] - 2026-07-21

### Security
- **Electron 28 → 43.** Electron ships inside the app, so its advisories were the only ones here that reached users — ASAR integrity bypass and AppleScript injection in `app.moveToApplicationsFolder` among them. `npm audit` now reports **0 vulnerabilities**, down from 20 (2 critical, 15 high). The remaining 44 Dependabot alerts were all build tooling that never leaves the build machine.

### Fixed
- **macOS and Windows builds were not the same software.** `package.json` depended on `presonus-studiolive-api` through `file:../presonus-studiolive-api`, but CI cloned `featherbear/master` while local builds used the sibling checkout — which carried unpublished fixes. The two platforms' artifacts were built against different versions of the mixer protocol library, v1.5.0 included. The library is now pinned to a published tag, so every platform builds identical code.
- **Dependabot had never run.** It clones only this repository, so the `file:` path dependency made it abort at file fetching every time — "path based dependencies could not be retrieved" — without opening a single PR. That is how 44 alerts accumulated unnoticed. With the dependency resolvable from a URL it works, and `.github/dependabot.yml` now configures weekly npm and github-actions updates, grouped so an Electron bump arrives as one PR.
- `app.dock.setIcon` is now guarded — Electron 43 correctly types `app.dock` as undefined off macOS.

### Changed
- Both workflows drop the clone-and-build-the-dependency step and the copy-into-`node_modules` dance; `npm ci` is enough. This also removes what the npm 10.9 workaround and the `windows-2022` pin were compensating for.
- `make release` reinstalls dependencies during pre-flight, so a local `make link-local` override can never end up in a release.
- New `make link-local` / `make unlink-local` for developing against a local checkout of the API library, replacing `install-deps` / `build-deps`.

### Upstream

Published as [`sandinak/presonus-studiolive-api` v1.8.1](https://github.com/sandinak/presonus-studiolive-api/releases/tag/v1.8.1) — per-client packet reassembly state (module-level singletons corrupted each other across concurrent connections), 15-second connection and handshake timeouts, sleep/wake reconnect, a `MeterServer` error handler that threw instead of rejecting, and discovery accepting port 53000 for R-series consoles. Plus a 160-test vitest suite.

## [1.5.0] - 2026-07-21

### Fixed
- **MIDI feedback to the DAW never worked.** The mixer's `level` event carries a `level` field on a 0–100 scale, but the handler read `data.value * 100` — so every mixer-originated fader move sent a `NaN` CC value. The same path also pre-converted the MIDI channel to 0–15 before `MidiManager` converted it again, sending Logic channel 1 out as wire channel −1. Both call sites now share `buildLevelFeedback()` so the scaling and channel numbering cannot drift apart again.
- **Unauthenticated remote denial of service in the TUIO listener.** The OSC bundle walker advanced its cursor by the element size declared in the packet, without validation; a negative size moved it backwards and spun the Electron main process forever — freezing the UI, MIDI and mixer control. The listener binds `0.0.0.0:3333`, so any host on the network could trigger it with a single 20-byte UDP datagram. Bundle elements are now rejected unless positive, 4-aligned and within the packet, and every read is bounded to its own element.
- **Renderer XSS reaching a capable IPC surface.** `sanitizeHtml` was defined in the renderer and never called, while mixer- and preset-supplied values flowed raw into ~30 `innerHTML` sites — and channel names come from the mixer over the network. Escaping is now applied at each sink. Downstream, `save-preset`/`load-preset` joined unsanitised names into a path (traversal), `save-preset-to-path` accepted any absolute path (arbitrary file write), and `openExternal` passed any scheme to the OS handler including `file:`. All three are constrained.
- **Fader filter did not persist** — `setFaderFilter` was the only setter that skipped `autoSavePreset()`.
- Degenerate note ranges (`noteMin === noteMax`) and non-finite levels no longer produce `NaN` MIDI messages; `noteMin: 0` and `controller: 0` are honoured rather than replaced by defaults.

### Added
- **CI workflow** running type check and the test suite on every push and pull request. `release.yml` only fired on `v*` tags and only built packages, so nothing gated ordinary commits.
- **Coverage reporting and thresholds.** Coverage was reported as 71% but was actually 32%: Jest's `roots` excluded `src`, so files with no tests were omitted from the report rather than counted as 0%. The three largest untested files were invisible.
- **LICENSE file** — the README linked to one that did not exist.
- Documentation for six shipped features that appeared nowhere: TUIO multi-touch, Edit/Run mode, transport control, fader stacking, per-mixer presets and DCA colours. Covered in the in-app help, `docs/usage.md` and the documentation site.

### Changed
- Test suite 295 → 570 passing tests; coverage 32% → 42%, honestly measured. `net-utils`, `preset-paths`, `url-safety`, `midi-feedback`, `preload`, `ipc-validators`, `update-checker` and `sanitize` are at 100%; `tuio-manager` at 96%.
- Corrected documented facts that had drifted from the code: the preset directory (`StudioLive Midi Controller`, not `studiolive-midi-controller/presets`), port 53000 as TCP with UDP 47809 for discovery, Node 22 and Python 3.11 build prerequisites, and per-architecture rather than universal macOS artifacts. `docs-consistency.test.ts` now pins these to their sources.
- Subnet-sweep helpers extracted from `index.ts` into `net-utils.ts` so they are testable outside Electron.

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

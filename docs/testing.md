# Hardware Test Matrix

Everything in this file needs a real console. It exists because CI cannot
cover any of it — GitHub runners have no MIDI interface and no mixer on their
network, so the parts of this app that matter most are also the parts
automation cannot reach.

## What is already covered, and by what

| Layer | Covered by | Platforms |
|-------|-----------|-----------|
| Unit + integration suite | `ci.yml`, every push | Linux, macOS, Windows |
| UI renders, every dialog and menu | `ci.yml` screenshot harness | Linux, macOS, Windows |
| Packages build | `release.yml` | macOS, Windows, Linux (x64 + arm64) |
| macOS signing, notarization, stapling | `make release` | macOS |

Nothing below is covered by any of that.

## Status legend

- **✅** verified on that combination
- **⬜** not yet verified
- **—** not applicable

## Where each platform actually stands

macOS is the only platform where the app has been used against a console.
Windows has shipped for several releases having never been run at all beyond
compiling. Linux has never been run interactively — only headless under xvfb.

| | macOS | Windows | Linux x64 | Linux arm64 / Pi |
|---|---|---|---|---|
| App launches from a packaged build | ✅ | ⬜ | ⬜ | ⬜ |
| MIDI devices enumerate | ✅ | ⬜ | ⬜ | ⬜ |
| Connects to a mixer | ✅ | ⬜ | ⬜ | ⬜ |
| Interactive click-through | ✅ | ⬜ | ⬜ | ⬜ |

> **Raspberry Pi:** Electron 44 removed 32-bit ARM (`armv7l`). A Pi running a
> 32-bit Raspberry Pi OS cannot run this app at all, regardless of what is
> built. A Pi 5 on 64-bit is `linux-arm64` and is fine. Confirm with
> `uname -m` before spending time here — `aarch64` good, `armv7l` stop.

---

## A. Discovery and connection

| # | Test | 16R | 32R | Notes |
|---|------|-----|-----|-------|
| A1 | UDP broadcast discovery finds the mixer | ⬜ | ⬜ | |
| A2 | **Discovery with Universal Control running** | ✅ | ⬜ | UC holds the discovery port; this is what the active TCP subnet sweep exists for. The sweep is also the least-tested code on the network path. |
| A3 | Manual IP connect | ⬜ | ⬜ | |
| A4 | Both mixers on the network at once | ⬜ | ⬜ | Discovery lists both with the right model, device name and serial |
| A5 | Reconnect after mixer power cycle | ⬜ | ⬜ | |
| A6 | Reconnect after host sleep/wake | ⬜ | ⬜ | Exercises `SleepWakeDetector` |
| A7 | Mixer mismatch prompt | ⬜ | ⬜ | Connect to a different console than the preset remembers |

## B. Channel data

| # | Test | 16R | 32R | Notes |
|---|------|-----|-----|-------|
| B1 | Names, colours and icons populate | ⬜ | ⬜ | |
| B2 | Channel counts correct | ⬜ | ⬜ | 16 vs 32 LINE |
| B3 | **Fader stacking above 16 channels** | — | ⬜ | **32R only.** Wrapping into two rows has never met a console with more than 16 channels. |
| B4 | Stereo-linked pairs render as pairs | ⬜ | ⬜ | |
| B5 | DCA groups and membership | ⬜ | ⬜ | |
| B6 | Mute groups and their names | ⬜ | ⬜ | |
| B7 | Level meters track real audio | ⬜ | ⬜ | Needs signal into the console |

## C. Control — the write paths

| # | Test | 16R | 32R | Notes |
|---|------|-----|-----|-------|
| C1 | Fader moves mixer volume | ✅ | ⬜ | |
| C2 | Mute / solo toggle | ✅ | ⬜ | |
| C3 | Main assign toggle | ⬜ | ⬜ | |
| C4 | Channel switches — 48V, polarity, mono | ✅ | ⬜ | Verified on 16R ch16 across a reconnect, and independently against Universal Control's own display |
| C5 | Processor switches — gate, comp, EQ, limiter | ✅ | ⬜ | Nested paths such as `limit/limiteron` |
| C6 | **Preamp gain reads correctly in dB** | ✅ | ⬜ | App set 20 dB (wire value 0.33333), Universal Control showed 20 dB. Confirms the scale at a non-degenerate point — at 0 dB every candidate mapping agrees, which is why the earlier round-trip proved nothing. |
| C7 | **Gain range is per-console, not assumed** | ⬜ | ⬜ | `getParameterRange` returned `{min:0,max:60}` on the 16R. If the 32R differs and the app follows it, the decision not to hard-code is proven. |
| C8 | **Console channel preset recall** | ✅ | ⬜ | Applied cleanly; 7 of 16 watched parameters changed. **Scope is narrower than assumed:** across four presets it rewrote EQ, compressor, gate and HPF but never touched preamp gain, phantom power or polarity. Still no undo. |

## D. MIDI

Per-platform, because each OS uses a different backend: CoreMIDI, WinMM, ALSA.

| # | Test | macOS | Windows | Linux |
|---|------|-------|---------|-------|
| D1 | Devices enumerate | ✅ | ⬜ | ⬜ |
| D2 | CC → volume | ✅ | ⬜ | ⬜ |
| D3 | Note → mute / solo | ✅ | ⬜ | ⬜ |
| D4 | **Note or CC → channel switch** | ⬜ | ⬜ | ⬜ | New in 1.8 |
| D5 | **CC → preamp gain** | ⬜ | ⬜ | ⬜ | New in 1.8. Also check a narrowed range caps the top of the sweep. |
| D6 | MIDI feedback returns fader position | ✅ | ⬜ | ⬜ |
| D7 | Device hot-plug and replug | ✅ | ⬜ | ⬜ |
| D8 | Transport start/stop reaches the DAW | ✅ | ⬜ | ⬜ |

## E. Run-mode interlock

The safety work added in 1.8. E2 is the one that matters most: the interlock
lives in the main process precisely so a controller cannot bypass it.

| # | Test | Expected |
|---|------|----------|
| E1 | 48V from the channel menu, in Run mode | Refused, shown greyed with "Edit mode only" |
| E2 | **48V from a mapped MIDI control, in Run mode** | **Refused.** Not merely hidden — the main process rejects it. |
| E3 | Preamp gain in Run mode, UI and MIDI | Refused both ways |
| E4 | Preset recall in Run mode | Refused |
| E5 | Gate / comp / EQ / limiter in Run mode | **Allowed** — deliberately available during a performance |
| E6 | Enabling 48V in Edit mode | Confirmation prompt |
| E7 | Disabling 48V in Edit mode | No prompt — the safe direction is not slowed down |

## F. Packaging, per platform

| # | Test | Notes |
|---|------|-------|
| F1 | macOS DMG opens on a machine that has never seen it | Gatekeeper; offline, to prove stapling |
| F2 | Windows NSIS installer installs and launches | |
| F3 | Windows portable `.exe` runs without installing | |
| F4 | Linux AppImage runs after `chmod +x` | |
| F5 | Linux `.deb` installs and launches | `sudo apt install ./*.deb` |
| F6 | Linux tarball extracts and runs | |

**Linux packages do not ship until F4–F6 pass alongside D1–D3.** They build on
every release and are kept as a workflow artifact, but are not attached to a
release yet.

---

## Calibrating a parameter with no published range

Preamp gain is the only audio parameter the console publishes a range for.
Everything else — HPF, delay, compressor threshold — arrives as a bare 0-1
float with no units, so adding any of them needs the scale worked out first.

The method that settled the gain question works generally: set a known wire
value from the app, then read the label off Universal Control with the channel
selected. One labelled point per parameter is not enough to fit a curve, but a
handful across the range is.

One point already collected: `line.ch16.filter.hpf` = **0.24314** displays as
**59 Hz**.

## Running these unattended

Much of A, B and C can run over the network without anyone at the console —
each test reads state, changes one value, verifies, and restores it. That is
how the switch and gain paths were verified on the 16R.

Some cannot, and it is worth being clear about which:

| Needs a person | Why |
|---|---|
| C6 gain in dB | Requires reading the console's own display |
| C8 preset recall | Irreversible; needs a channel you are willing to lose |
| B7 level meters | Needs real audio into the console |
| D1–D8 MIDI | Needs a controller physically attached |
| F1–F6 packaging | Needs someone to install and launch |

An unattended session is most valuable for **A2** (discovery while Universal
Control holds the port), the full sweep of **B**, and regenerating the
documentation screenshots against **real console data** rather than the
fixture board.

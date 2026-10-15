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
- **❌** verified broken
- **—** not applicable

## Where each platform actually stands

macOS is the only platform where the app has been used interactively against a
console. Windows has shipped for several releases having never been run at all
beyond compiling. Linux has never been run interactively, but since 1.9.0 the
hardware harness has run the real main process headless under xvfb on an Intel
Linux host, connecting to both bench consoles and completing full backups — 31 of
31 checks on a 16R and on a 32R.

| | macOS | Windows | Linux x64 | Linux arm64 / Pi |
|---|---|---|---|---|
| App launches from a packaged build | ✅ | ⬜ | ⬜ | ⬜ |
| MIDI devices enumerate | ✅ | ⬜ | ⬜ | ⬜ |
| Connects to a mixer | ✅ | ⬜ | ✅ ¹ | ⬜ |
| Interactive click-through | ✅ | ⬜ | ⬜ | ⬜ |

¹ From a source build under the hardware harness, headless — not a packaged build,
and with no MIDI interface attached (the host has no ALSA sequencer, which is what
found the enumeration crash fixed in 1.9.0).

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

## G. Configuration backup and restore

Backup, restore and inspect shipped in 1.9.0, in the app and as command-line
tools; the design is in [config-backup-restore-plan.md](config-backup-restore-plan.md).
The rows marked *harness* were verified by the hardware integration harness
(below), which drives the real main process and IPC handlers with the window
hidden — the code behind the buttons, not a person clicking them. The plan's later
tiers — authoring documents from live state, and migrating between models — are
not built, so many of the remaining rows are waiting on code rather than on a test
run.

| # | Test | 16R | 32R | Notes |
|---|------|-----|-----|-------|
| G1 | **State tree dumps and the redaction holds** | ✅ | ⬜ | `--dump-tree`. Check the file for the serial, owner, IP and access code before sharing it — the probe prints what it removed, but read the file too the first time. |
| G2 | Dumped tree covers every field a scene document carries | ⬜ | ⬜ | Decides whether tier 0 can author a complete scene from live state |
| G3 | **`StorePreset` creates a scene on the console** | ✅ | ⬜ | Gates the undo story. Watch for a `StoredPreset` reply |
| G4 | **Snapshot → change → recall restores prior state** | ✅ | ⬜ | The undo C8 says does not exist |
| G5 | App-authored `.bak` restores through Universal Control | ⬜ | ⬜ | **The main tier-0 risk.** Round-trip: dump → author → restore → re-dump → diff |
| G6 | `PS` write sets a channel label | ⬜ | ⬜ | Unproven. Only needed if `presetChannelNames` does not cover it |
| G7 | `PS` write sets `iconid`; colour via `PC` | ⬜ | ⬜ | |
| G8 | 16R → 32R migration, preflight diff accurate | — | ⬜ | 16 → 32 line, 6 → 16 aux, 8 → 24 DCA |
| G9 | 32R → 16R migration, overflow channels dropped | ⬜ | — | |
| G10 | Restore with Universal Control connected | ⬜ | ⬜ | Detect and warn; do not arbitrate |
| G15 | **Backup from the app, with a console connected** | ✅ | ✅ | *Harness.* Was ❌ — stalled at document 1 of 70 and wedged the main process. Fixed in 1.9.0: the app's own console chatter, and four connect paths racing each other, were stalling and severing the transfer (plan §12.2, CHANGELOG). 70 documents in 8.6s wired on the 16R, 66 in 10.8s on the 32R |
| G16 | **Restore from the app UI, including the overwrite confirmation** | ⬜ | ⬜ | The harness covers planning (writes nothing), refusal without the acknowledgement, and that a used plan cannot be re-applied. An applied restore has not been run through the app |
| G17 | Progress bar moves during a backup | ✅ | ✅ | *Harness:* `console-transfer-progress` reaches the renderer. The bar moving on screen has not been watched |
| G18 | Restore refused in Run mode, from the UI | ⬜ | ⬜ | Policy is verified; the UI message is not |
| G11 | Permissions-restricted restore reports refusals | ⬜ | ⬜ | Rather than failing quietly |

A dump from each console is the prerequisite for most of the rest, so G1 is
worth doing before anything else here — including before deciding whether the
plan's later tiers are worth building.

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

## The probe

`tools/hw-probe.js` fills in most of these rows without hand-rolling a script
per machine. It is read-only unless explicitly told otherwise:

```bash
node tools/hw-probe.js                  # discover, then probe what it finds
node tools/hw-probe.js 192.168.21.41    # skip discovery, go to a known mixer
node tools/hw-probe.js --listen         # also wait 15s for MIDI input (D2-D5)
node tools/hw-probe.js 192.168.21.41 --write --channel 16
node tools/hw-probe.js --dump-tree      # also save the live state tree (G1)
```

It reports host and node versions, the MIDI backend and every port it can see,
whether a port opens and closes cleanly, discovery results, connect time,
channel counts, the published gain range, and a sample of channels with their
gain in dB. `--write` flips one switch on the named channel and restores it —
it refuses to guess a channel, and there is no default.

On a virtual machine, discovery finding nothing almost always means NAT
networking; bridged is required for UDP broadcast to reach the guest.

### Dumping the state tree

`--dump-tree` writes everything the console publishes to a JSON file, and prints
the root list, the leaf-parameter count, and which parameters carry a published
range. It needs a build first (`npm run build`), because it uses the project's
own redactor rather than a second copy of those rules.

This matters more than it looks. Nothing in this project has ever captured a
real state tree: the protocol library's type was generated from someone else's
console in 2021 and is already missing parameters that appear in real documents
(`sub`, `mapping`, `global.mastermixlock`), and every fixture here is synthetic.
A dump from each model is what the backup work in
[config-backup-restore-plan.md](config-backup-restore-plan.md) is designed
against.

The file is redacted before it is written, not after: the raw tree carries the
console's serial, its registered owner, its network configuration and its
remote-access code. `--anonymise` additionally strips channel labels, DCA and
mute-group names and loaded scene names.

```bash
node tools/hw-probe.js --dump-tree                  # debugging your own console
node tools/hw-probe.js --dump-tree --anonymise      # safe to commit or attach
```

**Use `--anonymise` before committing a dump as a fixture or attaching one to an
issue.** Channel labels on a working board name the people standing behind them.
Without it the probe says so explicitly rather than leaving you to remember.

### The hardware integration harness

`tools/hw-integration/run.js` exercises the app itself against a console with
nobody clicking anything:

```bash
npm run test:hardware -- 192.168.21.41
node tools/hw-integration/run.js 192.168.21.41 --keep   # leave the artifacts
```

It loads the **real main process** — the same `ipcMain` handlers, the same
preload allowlist, the same renderer functions the buttons call — with only two
things replaced: the file dialogs answer from a queue instead of waiting for a
human, and the window is hidden. That is the gap nothing else closes. The unit
suite covers the modules, the CLI tools cover the protocol against hardware, and
the screenshot harness preloads a *mock* `electronAPI`, so it proves the dialog
renders and nothing about whether the IPC behind it works.

It checks the backup handler end to end, that progress events reach the
renderer, that a cancelled dialog is reported rather than erroring, that restore
planning writes nothing, that applying without acknowledging overwrites is
refused, that a consumed plan cannot be re-applied, and that Run mode blocks
restore while still allowing backup.

**It leaves the console as it found it.** A backup is taken before anything
else, and the console's documents are compared against it at the end; if they
differ the run says so and prints the command to put them back. Nothing is
written to a slot the harness did not create.

Keep a restore point outside the harness too, somewhere that is not a temporary
directory:

```bash
node tools/backup-console.js 192.168.21.41 -o ~/Documents/16R-restorepoint.bak
```

### Running the harness on another machine

Both harnesses run headless — the window is never shown and the dock icon is
hidden — but on macOS Electron still activates as an app, so a run on your own
workstation will interrupt whatever you are doing. Running from a second machine
avoids that, and is also how the Intel Linux results above were produced.

```bash
tools/setup-test-host.sh 192.168.1.245
ssh 192.168.1.245 'cd studiolive-midi-controller && node tools/hw-integration/run.js 192.168.21.41'
```

The host needs ssh key access, Node and yarn on its `PATH`, and a network route to
the console. A Linux host also needs `xvfb` — the launcher wraps itself in
`xvfb-run` when there is no display — and a macOS host needs a logged-in session.

The script syncs this working copy (without `node_modules`, `dist` or `release`),
installs, builds, and checks the transfer and keep-alive fixes are present. It ships
the protocol library from your **sibling checkout** of `presonus-studiolive-api` as a
packed tarball, not from the pinned tag, so the host tests whatever that checkout
holds. That is what you want while changing the library, and it means a passing
remote run says nothing about the pin: before a release, check that
`package.json` pins a tag containing the same changes.

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

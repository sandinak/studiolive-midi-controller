# Console Configuration Backup and Restore — Analysis and Plan

**Status:** Proposal. Nothing here is implemented.
**Revision 3** — the document format is no longer inferred. A real StudioLive 32R
backup (`StudioLive32R_2026-10-05.bak`, 2026-10-05) has been dissected; §1.4 is
now measured fact, and the recommended architecture changed again as a result.

Revision history: R1 planned a parameter replay as the primary mechanism. R2
found UC's backup/restore to be a protocol feature the API library is missing,
demoting replay to a fallback. R3 confirms the artifact format outright — which
means **the app can author and read a real mixer backup without any new protocol
work at all.**

**Motivation:** Universal Control's backup/restore has become unreliable, and the
app already holds a live, complete picture of console state.

---

# Part 1 — Analysis

## 1.1 The short version

**Both halves are now tractable, and the artifact format is known.**

The console pushes its *complete* configuration to every client on connect, as a
zlib-compressed UBJSON tree (`ZB`, or `CK`-fragmented `ZB`). Everything in the
request — channel labels, colour, icon, stereo link, gain, submix config and
labels — is in that tree already. Reading it is a day's work.

For restore, the obvious reading of the API library is bleak: it exposes only
single-parameter writes, so a full restore looks like a replay of ~11,000
unacknowledged packets in a dependency-sensitive order. **That reading is wrong,
because the library implements only a fraction of the protocol.** UC's binaries
show a complete document store — `StorePreset`, per-document transfer in both
directions, and a `createBackup` / `restoreBackup` pair whose artifact is a ZIP
of JSON documents (§1.3).

And that artifact has now been dissected (§1.4): a mixer backup is a plain ZIP
whose scene file is **flat JSON, keyed exactly like the live state tree, in real
engineering units** — dB, Hz, seconds. 11,175 parameters for a 32R.

The consequence worth leading with: **the app can read and write that file today,
with no new protocol work at all.** Capture the live tree, emit a valid `.scene`,
zip it. That is a complete, correct backup — and because the format is the
vendor's own, a cross-model migration becomes a JSON-to-JSON transform in real
units rather than the wire-fraction guesswork earlier revisions were resigned to.

What remains genuinely unknown is only the *transport*: how to push a document to
the console ourselves, rather than handing the file to UC. That is one spike, and
the feature has value before it lands.

## 1.2 Where the code lives

| Concern | Location |
|---|---|
| Wire protocol, state tree, all parsers | `/Volumes/Ext/git/presonus-studiolive-api` (pinned `v1.10.0`, commit `1a627ba`) |
| App-side wrapper | [src/main/mixer-manager.ts](src/main/mixer-manager.ts) |
| IPC + discovery | [src/main/index.ts](src/main/index.ts) |
| Run-mode interlock | [src/main/switch-policy.ts](src/main/switch-policy.ts) |

The app repo contains **no wire-protocol code at all**. Most of the work lands in
the protocol fork. Read the protocol in that checkout —
`node_modules/presonus-studiolive-api` is minified to one line per file.

## 1.3 What Universal Control actually does

Evidence from the installed app (`/Applications/Universal Control.app`, Fender
branding, Jan 2026 build). All of this is **string-table evidence, not a traffic
capture** — the field names and command ids are confirmed to exist, their exact
semantics are not. Treat as a map, not a specification.

The relevant binary is `Contents/PlugIns/studiolivepanel.bundle` (10.7 MB).
`Contents/Frameworks/ucnet.framework` is transport only.

### The document/preset command set

Adjacent in the string table, which is how these were found:

| Command | Adjacent fields | Library has it? |
|---|---|---|
| **`StorePreset`** | `presets`, `presetTarget`, `presetFile` | **no** |
| `RestorePreset` | `presetTargetSlave`, `presetChannelNames` | yes (without `presetChannelNames`) |
| `ReorderPreset` | — | no |
| `CopyPreset` | `targetSlot` | no |
| `SetPresetAccess` | `presetWritable`, `presetReadable` | no |
| `StoredPreset` / `RecalledPreset` | `presetName`, `presetType` | no — these are *notifications*, i.e. confirmation |
| `DeletedPreset` / `RenamedPreset` | — | no |

`StorePreset` sits immediately before `RestorePreset` and shares its field names.
The library's `RestorePreset` payload is
`{id, url:"presets", presetTarget, presetTargetSlave, presetFile}`, so
`StorePreset` is almost certainly the same shape. **That is the undo problem
solved**, and it is a handful of lines.

`presetChannelNames` as a field of `RestorePreset` is worth chasing — it hints
that a recall can carry channel labels, which is the single thing the parameter
path needs an unproven `PS` write for.

### Document types, with MIME types

This is the catalogue of what the console stores:

| Type | key | MIME |
|---|---|---|
| Mixer Scene | `scene` | `application/x.presonus-mixerscene+json` |
| Channel Preset | `channel` | `application/x.presonus-mixerchannel+json` |
| FX Preset | — | `application/x.presonus-mixerfx+json` |
| FX Reverb / Delay | `reverb` / `delay` | `…-mixerfxreverb+json` / `…-mixerfxdelay+json` |
| GEQ Preset | — | `application/x.presonus-mixergeq+json` |
| Advanced Scene | — | `application/x.presonus-mixeradvancedscene+json` |
| Quick Scene | `mixscene` | `application/x.presonus-mixerquickscene+json` |
| Mixer Project | `proj` | `application/x.presonus-mixerproject` |
| **Mixer Backup** | — | **`application/x.presonus-mixerbackup+zip`** |

**Every document is JSON. A full mixer backup is a ZIP of them.** That is the
whole feature, and it is a file format we can read and write.

### UC's backup/restore UI surface

From `UCSurfaceBrowserComponent`:

```
localList  remoteList  locationList  scenesList  refreshLocalList  refreshRemoteList
sendToDisk  sendAllToDisk  sendToMixer        ← per-document transfer, both directions
createBackup  restoreBackup                  ← the full-mixer pair
addRemotePreset  loadRemotePreset  removePreset
storeRemotePresetName  storeNamedRemotePreset
copyProject  copyScene  pasteProject
```

A local list and a remote list with `sendToDisk` / `sendToMixer` between them.
This is exactly the feature being asked for, already specified by the vendor.

### Other protocol the library is missing

- **`SynchronizePart`** with a `part` field — a *partial* state sync. Would let a
  backup refresh one subtree instead of re-reading everything.
- **`MethodResponse`** — there is a request/response method-call mechanism beyond
  the fire-and-forget parameter writes.
- `SubscriptionLost`, `UpdatePalette`, `clientWANConnection`.
- `fileSizeNotify`, `callid`, `files`, `FileRequestOperation` — the FR/FD
  mechanics. `callid` matches the library's 2-byte request id.
- `CreateMixerDumpFile` / `createMixerDumpFile`, `takeMixerScreenshot`,
  `displays/display0.bmp` — a diagnostic dump, probably useful for support.

### A hardware-free test target

`Contents/simulation/libstudiolive3simulation.dylib` (8.1 MB) contains
`Synchronize`, `Subscribe`, `StorePreset` and `RestorePreset`. **UC ships a
StudioLive III simulator that implements the preset protocol.** If it can be
driven standalone, the entire feature is developable and testable without a
console. Worth an afternoon to find out.

Model codenames, for reading the rest of the binary: `avenger.hulk`,
`avenger.thor`, `avenger.ironman`, `AvengerConsoleMixerComponent`,
`AvengerRackMixerComponent` (the R series — the 16R and 32R),
`AvengersBackupRestore`, platforms `platform-dspv3` / `platform-dspv3lcd`. Local
library path is `PreSonus/StudioLive III/Local`.

## 1.4 The document format — measured, from a real 32R backup

`StudioLive32R_2026-10-05.bak` is a **ZIP**, exactly as the
`application/x.presonus-mixerbackup+zip` MIME type predicted. 47 KB, 64 entries:

```
Fat/01.Kick 1.Drum.channel  …  Fat/50.Speech 2.Vocal.channel     50 channel presets
FX/01.Dry Slap Delay.Mono_Delay.fx  …  FX/13.*.Pingpong_Delay.fx 13 FX presets
Scene/01.Zero Out (Board Reset).scene                            1 scene, 240 KB
```

Note the `NN.Title.Category.channel` filenames — the same convention
[src/main/mixer-manager.ts](src/main/mixer-manager.ts) already parses to recover a
preset's instrument category. **The archive is mostly the factory library; the
scene is the valuable part** (240 KB of the 308 KB uncompressed).

### The scene document

Plain JSON, flat, and its **root keys are the same names as the live state tree**:

| Scene root | Entries on the 32R |
|---|---|
| `line` | 32 |
| `aux` | 16 |
| `sub` | 4 |
| `fxbus` / `fxreturn` / `fx` | 4 each |
| `filtergroup` (DCA) | **24** |
| `geq` | 8 |
| `return` | 3 |
| `main` / `talkback` | 1 each |
| `mutegroup`, `outputpatchrouter` (116), `signalgen`, `stageboxsetup` (1 key) | — |
| `advancedscenefilters` (20), `projectfilters` (13), `mapping` (27) | — |

**11,175 leaf parameters total** — `line` 5,280, `aux` 1,984, `filtergroup` 1,512.
That independently validates the 9,000–12,000 replay estimate in §1.7(4).

A `line` channel is 103 keys — 95 scalars plus `opt`, `filter`, `gate`, `comp`,
`eq`, `limit`, `linkoptions`, `dca`. **Everything the request asked for is a
plain field in it:**

```jsonc
"username": "Ch. 1",  "color": 0,  "iconid": "",          // label, colour, icon
"link": 0, "linkmaster": 0,
"linkoptions": {"ch_gain":0,"pan":0,"fader":0,"dyn":0,"ch_name":0,"ins_fx":0},
"volume": -84.0,                                          // dB
"pan": 0.5, "stereopan": 1.0,                             // 0–1
"preampgain": 0.0, "digitalgain": 0.0, "48v": 0, "polarity": 0, "10db_boost": 0,
"lr": 1, "sub1": 0, …, "assign_fx1": 1, …,
"inputsrc": 0, "adc_src": 0, "avb_src": 0, "usb_src": 0, "sd_src": 0, …,
"filter": {"hpf": 24.0},                                  // Hz
"gate":  {"on":0, "threshold":-84.0, "range":-84.0,       // dB
          "attack":0.005, "release":0.7,                  // seconds
          "keyfilter":40.0, "keylisten":0, "expander":0},
"comp":  {"on":0, "threshold":0.0, "ratio":2.0,           // dB, ratio
          "attack":0.02, "release":0.15, "gain":0.0,
          "softknee":0, "automode":0, "keyfilter":40.0, "keylisten":0,
          "__classid":"{870D04F7-212E-4F9C-ADBB-39A97216433F}"},
"eq":    {"eqallon":1, "eqgain1":0.0, "eqq1":0.6, "eqfreq1":130.0,  // dB, Q, Hz
          "eqbandon1":1, "eqbandop1":0, …4 bands…,
          "__classid":"{A0A8A068-14F0-4B04-BB6F-AF8329D0E8EE}"},
"limit": {"limiteron":0, "threshold":0.0},
"dca":   {"volume":0.0, "aux1":…, "fx1":…}                // DCA contribution
```

And a submix — `aux.ch1`, 81 keys — carries exactly the config and labels asked
for: `username: "Aux 1"`, `color`, `iconid`, `busmode`, `busdelay`, `bussrc`,
`lr_assign`, plus `link`/`linkoptions`, `filter`, `comp`, `eq`, `limit`. No
`gate`, correctly — buses do not have one.

DCA: `filtergroup.chN` = `{name: "DCA 1", iconid, volume}` + per-source
membership. Mute groups: `mutegroup{N}username`, `mutegroup{N}mutes`, plus
`safe_mutes`. GEQ: `gain1..31` + 3. FX: `fx.chN.plugin` with its own `__classid`
and real units (`lpf: 9500.0` Hz, `lfdamp_gain: -3.1` dB).

### What this settles

**(1) Documents store real engineering units — confirmed on III.** dB for levels,
gains and thresholds; Hz for frequencies; seconds for attack/release; ratio for
ratio. Revision 1 concluded that unit-accurate cross-model transfer of
EQ/comp/gate was impossible because only `preampgain` publishes a range. That was
true of the *wire*. The document layer has the units and the console converts, so
**routing config through documents sidesteps the calibration problem entirely** —
and makes cross-device translation a JSON-to-JSON transform in real units rather
than a wire-fraction guess.

`filter.hpf: 24.0` also reconciles the one hand-calibrated datapoint in
[docs/testing.md](docs/testing.md) (wire `0.24314` displaying as 59 Hz): 24 Hz is
HPF-at-minimum, 59 Hz is a set value. Same parameter, two representations.

**(2) The EQ / comp / gate inventory, which was unknown.** The state tree type
declares `eq.values` and `comp.values` as bare `{[key: string]: number}` — the
2021 capture never enumerated them. Now measured. Note the structure is
**channel-type dependent**: `line` has a **4-band** EQ, `aux` has a **6-band**
(`eqgain1..6`, `eqbandop` on the outer two). Anything generic over EQ must read
the band count from the data, not assume it.

**(3) It explains hardware matrix row C8.** A `.channel` preset's top level is
only `filter, gate, comp, limit, eq` — gain, phantom, polarity, label, colour and
icon are **not in a channel preset at all**. C8's observation now has a mechanism.

**(4) Two corrections to the library's tree type.** `sub` and `mapping` are in the
scene but absent from `ZlibPayloadChildren` — the type was generated from a
console without SUB groups, so it is incomplete. `safe_mutes` is likewise missing
from `MutegroupValues`.

**(5) Two app limits the 32R exceeds.** The scene shows **24 DCA groups** and 4
SUBs on this console. The renderer hard-codes `DCA: 8` and `SUB: 8` and always
fetches exactly 8 of each ([src/renderer/index.html:5135](src/renderer/index.html#L5135),
[:7646](src/renderer/index.html#L7646)), and DCA membership is scanned over a
fixed `line1..line64` in `mixer-manager.ts`. Worth fixing independently of this
feature.

### Three document types, with different scopes

A second backup — `StudioLive16R_2026-10-06.bak`, from a working 16R — shows the
archive can also carry user projects:

```
Project/01.PHS-Choir.proj/01.Starting.scn      131 KB   ← a real working scene
Project/01.PHS-Choir.proj/PHS-Choir.cnfg        72 KB   ← project-level config
Project/02.Camp Evo.proj/01.New Scene.scn      133 KB
Project/02.Camp Evo.proj/Camp Evo.cnfg          72 KB
Scene/01.Zero Out (Board Reset).scene          110 KB
Fat/ (51)   FX/ (13)
```

The three types are **not interchangeable**:

| Root | `.scn` (scene in project) | `.cnfg` (project config) | `.scene` (standalone) |
|---|---|---|---|
| `line` `aux` `fxbus` `fxreturn` `main` `return` `talkback` | ✅ | ✅ | ✅ |
| `filtergroup` `mutegroup` `fx` `signalgen` | ✅ | — | ✅ |
| `autofiltergroup` | ✅ | — | — |
| `geq` `outputpatchrouter` `stageboxsetup` | — | ✅ | ✅ |
| **`global`** `mastersection` | — | **✅ only here** | — |
| `advancedscenefilters` `projectfilters` | — | — | ✅ |
| `mapping` `sub` | — | — | ✅ (32R) |

So **a complete capture is `.cnfg` + `.scn`** — `global` (sample rate, DCA/pan
mode, brightness, the `fltr*` scene-filter flags, `mastermixlock`) lives *only* in
the project config. A standalone `.scene` is close but carries no `global`.

`.cnfg`'s `global` notably does **not** carry `mixer_name`, `devicename`,
`mixer_serial` or `mixer_version` — device identity is correctly excluded from a
portable document, so the app must record it in its own wrapper (§2.2 `source`).

### The colour encoding, and `iconid`

From the working 16R scene — this is what the reset scene could not show:

```
"username": "Piano",            "color": 4283284562,  "iconid": "keyboards/piano"
"username": "Bass",             "color": 4283284562,  "iconid": "guitars/bass"
"username": "Main Mix",         "color": 4278190335,  "iconid": "other/computer"
"username": "In Ear Mix",       "color": 4278190335,  "iconid": "other/iem"
"username": "Walkie",           "color": 4294955598,  "iconid": ""
"username": "Ch. 8",            "color": 0,           "iconid": ""
```

**`color` is an unsigned 32-bit ARGB integer.**

| Value | Hex | A / R / G / B | CSS |
|---|---|---|---|
| `4283284562` | `0xFF4DBC52` | 255 / 77 / 188 / 82 | `#4DBC52` green |
| `4278190335` | `0xFF0000FF` | 255 / 0 / 0 / 255 | `#0000FF` blue |
| `4294955598` | `0xFFFFD24E` | 255 / 255 / 210 / 78 | `#FFD24E` amber |
| `0` | `0x00000000` | alpha 0 | unset |

Note the library's `**.color` transform does `writeInt32LE` then reads 4 bytes as
hex — a different byte order from this. Reconcile before relying on either.

**`iconid` is a structured path**, `category/name`: `keyboards/piano`,
`guitars/bass`, `guitars/electric2`, `drums/drumpad`, `other/iem`,
`other/computer`. The renderer currently keyword-matches it
([src/renderer/index.html:3740](src/renderer/index.html#L3740)); the real format is
a two-level path and could be matched exactly.

Also confirmed here: **`preampgain` is dB** (`13.8`, `0.8`), **`volume` is dB**
(`-0.566`, `0.119`, `-84.0`), and aux labels carry the `N:` prefix (`1:Ear-ALL`,
`2:Ear-Bass`) that `getChannelName` already strips — that workaround is real and
necessary.

### Model deltas, measured

The migration problem, concretely:

| Root | 16R | 32R |
|---|---|---|
| `line` | 16 | 32 |
| `aux` | 6 | 16 |
| `sub` | **none** | 4 |
| `fxbus` / `fxreturn` / `fx` | 2 each | 4 each |
| `filtergroup` (DCA) | 8 | **24** |
| `autofiltergroup` | 12 | — |
| `return` | 1 | 3 |
| `geq` | 8 | 8 |

### ⚠ What UC's backup does *not* capture

**A backup contains the console's stored document library, not its live state.**

The 32R archive has **no `Project/` directory at all** — only the factory
`Zero Out (Board Reset)` scene — despite coming from a working board. The 16R
archive has two real projects because someone saved them.

So whatever is dialled into a console *right now* is absent from its backup unless
it was first stored as a scene. For an engineer who works live without saving
scenes, UC's backup is empty of everything they care about. **This is plausibly a
large part of why UC's backup/restore feels broken**, and it is worth confirming
against the actual complaint before building anything.

It is also the clearest argument for this feature existing: **the app reads the
live tree.** Tier 0 can capture the board as it stands, with no "did you remember
to save a scene first" precondition — something UC does not appear to offer at
all. That is a genuine capability difference, not a reimplementation.

### Superseded: the earlier inference

Revision 2 reasoned from
`~/Documents/PreSonus/StudioLive AI/Library/Presets/Fat/Acoustic Strumming.Guit.channel`,
an **AI-generation** (2nd-gen) file, and flagged that the carry-over to III was
strong but unproven. It is now proven directly. The AI-era `comp` was
`{on, softknee, automode, threshold, ratio, attack, release, gain}`; III adds
`keyfilter` and `keylisten`. The two DSP `__classid` GUIDs are identical across
both generations and match `CompClassID` / `EqClassID` in the III tree type.

## 1.5 The read side: what a backup can contain

The tree shape is transcribed in `src/lib/types/ZlibPayload.ts` in the fork
(1190 lines). 28 roots. Mapping the request onto them:

| Requested | Path | Type |
|---|---|---|
| **Channel label** | `line.chN.username` | string (`PS`) |
| — factory label | `line.chN.name` | string, read-only in practice |
| **Colour** | `line.chN.color` | int32 → hex (`PC`) |
| **Icon** | `line.chN.iconid` | string (`PS`) |
| **Stereo** | `link`, `linkmaster`, `panlinkstate`, `linkoptions.{ch_gain,pan,fader,dyn,ch_name,ins_fx}` | floats |
| **Gain** | `preampgain` (0–1 of a *published* range), `digitalgain`, `trim`, `gaincomp`, `10db_boost` | floats |
| Phantom / polarity / mono | `48v`, `polarity`, `mono`, `monolevel`, `centerdiv` | floats |
| Input source | `inputsrc`, `adc_src`, `avb_src`, `usb_src`, `sd_src` (+`_src2`) | enum indices |
| Processing | `filter.hpf`, `gate.*`, `comp.*`, `eq.*`, `limit.*`, `opt.{eqmodel,compmodel,swapcompeq}` | floats (§1.4 for names) |
| **Submix config + labels** | `aux.chN.*` — `username`, `color`, `iconid`, `busmode`, `auxpremode`, `bussrc`, `busdelay` + full channel bag | mixed |
| Sends / assigns | `line.chN.aux1..32`, `FXA..H`, `assign_aux1..32`, `assign_fx1..8`, `lr`, `sub1..4` | floats |
| FX buses / returns | `fxbus.chN.*`, `fxreturn.chN.*`, `fx.chN.{type,pluginstate}` | mixed, `pluginstate` opaque |
| Main / DCA / auto-DCA | `main.ch1.*`, `filtergroup.chN.{name,iconid,groupnum,volume,mute,line1..64}`, `autofiltergroup.chN.*` | mixed |
| Mute groups | `mutegroup.mutegroup{N}username`, `mutegroup{N}mutes` | strings |
| GEQ | `geq.chN.*` | floats |
| Identity | `global.{mixer_name,devicename,mixer_version,mixer_version_date,mixer_serial,samplerate}` | mixed |
| Scene-safe / filters | `global.{scene_safe_ins_1_32,scene_safe_ins_33_64,fltr*}` | floats |
| Output routing | `outputpatchrouter.*`, `stageboxsetup.*`, `earmixsetup.*` | enum indices |
| Permissions / network | `permissions.*`, `networksetup.*` | mixed |

**Everything asked for is present.** The read side is not the risk.

Note there is no image transfer: `iconid` is a string, rendered from a local
lookup (`ICON_MAP` at [src/renderer/index.html:3494](src/renderer/index.html#L3494)).
"Icon" means the id, which is what the console stores too.

## 1.6 The write side

Confirmed working today (library-implemented):

| # | Mechanism | Payload | Covers |
|---|---|---|---|
| 1 | `PV` | `path\0\0\0` + float32 LE | every numeric and boolean parameter |
| 2 | `PC` | `path\0\0\0` + raw bytes | `color` (3 bytes hex + alpha) |
| 3 | `JM RestorePreset` | `{id,url,presetTarget,presetTargetSlave,presetFile}` | recall a stored document by filename |
| 4 | `FR` | `id(u16BE) + "List" + key + \0\0` | *list* projects, scenes, channel presets |

Known to exist, not implemented (§1.3):

| # | Mechanism | Status |
|---|---|---|
| 5 | `JM StorePreset` | command id and fields confirmed; shape inferred from `RestorePreset`. **Cheap, high value — this is undo.** |
| 6 | Document transfer both ways | `sendToDisk` / `sendToMixer` exist; wire format unknown. **The one real unknown.** |
| 7 | `createBackup` / `restoreBackup` | exist; artifact is a ZIP of JSON |
| 8 | `PS` write — strings | format known from the parser and the fork's own `buildPSPacket` test helper (`key\0` + 2 pad + `value\0`), symmetric with `PV`/`PC`. **Unproven on hardware.** Needed only for the replay path, and possibly obviated by `presetChannelNames`. |

On `FD` today: handling is `JSON.parse` of a reassembled buffer, built for
directory listings. `parseChunk` reads `totalSize` and `payloadSize` as
`UInt16LE`, capping a transfer at 64 KB — for real document payloads that is
probably simply wrong, and is likely the first thing to fix when implementing #6.

## 1.7 The hard problems

Which of these bite depends on the tier (Part 2). Problems (1), (2) and the unit
half of (3) are **replay-only** — the document path avoids them.

### (1) Value fidelity — the library transforms on ingest *(replay only)*

`src/lib/util/transformers.ts` applies a path-pattern transform to every inbound
value, **asymmetrically**: `*.ch*.volume` ×100 on tree ingest; `**.color` →
hex string; `mute`/`solo`/`48v`/`link`/`assign_*` coerced to booleans; floats
arrive as Buffers from `PV` but numbers from the tree, so the same parameter has
two in-memory shapes depending on provenance (`getSwitch()` carries a docblock
about exactly this).

A backup read from `client.state` therefore stores *post-transform* values, and
restoring means inverting a table never designed to be inverted. **Capture the
raw UBJSON, before `zlibParseNode`**; the transformed view is for display only.

### (2) Write ordering *(replay only)*

- `link` before `pan`/`stereopan` — `setPan` branches on link state and the
  console mirrors across a linked pair.
- `linkoptions.*` decides *which* properties follow the link; wrong order means
  later writes mirror or not, unpredictably.
- `setLink`'s own comment: "only an odd numbered channel is targeted (`& ~1`)".
- `busmode`/`bussrc` change what other aux parameters mean.
- `inputsrc` before gain. `opt.eqmodel`/`compmodel` before band values.
- `48v` last, behind its own confirmation — it can destroy a ribbon microphone.

### (3) Cross-device portability *(both tiers)*

- **Channel counts differ and are discovered, not declared** — derived by counting
  tree keys (`Client.ts:270-301`). 16R has no SUB groups; `MASTER`/`MONO` are
  64S-only. 32→16 must drop or map; 16→32 leaves the remainder untouched.
- **Capabilities differ per channel.** `"48v"`, `preampgain`, `adc_src`,
  `sub1..4`, `lr_assign` are all *optional* in the tree type — a digital or
  AVB-sourced channel has no preamp at all.
- **`preampgain` is a fraction of a device-published range.** Same 0.333 is a
  different dB value on two consoles. Store dB; convert using the *target's*
  range. Matrix row C7 exists to find out whether the 32R differs from the 16R.
- **Units for everything else**: on the wire, bare 0–1 floats with no published
  range — so replay cannot translate them across models. **In documents, real
  units (§1.4)** — so the document path can. This is the strongest argument for
  the tiering.
- **Routing enums are device-specific indices** into per-device lists
  (`stageboxsetup.strings.avb_src_1_8`, …). Indices do not port. Translate
  through the string tables or exclude; default to exclude.
- **`fx.chN.pluginstate` is opaque.** Restore only on matching model+firmware.
- **A scene document is model-scoped.** The document path will not move a 32R
  scene onto a 16R. That is precisely why the replay tier survives.
- **Firmware is never read today.** `global.mixer_version` exists and nothing
  looks at it. Paths have moved across firmware before.

### (4) No acknowledgement, no flow control *(replay only)*

`_writeBytes` resolves on the socket write callback; the console never acks a
`PV`. Sizing from the tree type — `FluffyValues` is 174 fields per channel, plus
gate 10, comp 9, limit 2, eq 20, linkoptions 6, filter 1, opt 3 — a 16R lands
around 4,000–5,000 writes, a 32-channel console with 16 auxes 9,000–12,000.
Firing those unacknowledged as fast as the socket accepts will drop values and may
trip the 3 s keep-alive. Pacing plus read-back verification is mandatory.

Note that `StoredPreset` / `RecalledPreset` notifications (§1.3) give the document
path something the replay path lacks entirely: **confirmation from the console**.

### (5) Permissions and scene-safe can silently refuse writes *(both)*

`permissions.*` includes `rename`, `preamps`, `assigns`, `scenes`,
`channel_source`, `eq_dyn`, `geq`, `fx`, `groups`, `mute_groups`; plus
`global.scene_safe_ins_*` and the `fltr*` flags. Read these up front and
**report what cannot be written** rather than writing into a void. `SetPresetAccess`
with `presetWritable`/`presetReadable` suggests per-document access control too.

### (6) Universal Control contention *(both)*

UC holds the discovery port already — the active TCP sweep exists for that reason.
If UC is connected during a restore it will see every change and may fight them.
Detect and warn; do not arbitrate.

### (7) No undo today *(solved by `StorePreset`)*

Row C8: channel-preset recall "cannot be undone from the app". `StorePreset`
(§1.3) fixes this directly — snapshot to a console scene before touching
anything. This is the cheapest high-value item in the whole plan.

## 1.8 Safety: allowlist, never denylist *(replay only)*

The state tree contains parameters that must never be written from a replayed
file: `networksetup.{ipaddress,subnet,gateway,assignmode}` (bricks network
access), `permissions.access_code` (locks the user out),
`softpower.initiateSoftPower` (powers the console down), `sdcard.do_format`
(formats the card), `transport.{record,play,stop}` and `session.*` (starts and
stops recordings), `stageboxsetup.apply` / `earmixsetup.apply*` / `identify`
(action triggers, not settings), and read-only telemetry (`clip`, `reduction`,
`peak`, `status`, `progress_*`).

A denylist will miss one the first time the tree gains a field. **Drive the
restore engine from an explicit allowlist**, with everything unlisted ignored by
construction.

---

# Part 2 — The Plan

## 2.1 Four tiers

Ordered by what they depend on, which is also roughly the order to build them.

| Tier | Mechanism | Covers | Depends on |
|---|---|---|---|
| **0 — Document I/O** | read + author `.bak` ZIPs and `.scene` JSON | backup, inspection, diffing, cross-model migration | **nothing new** — §1.4 is measured |
| **A — Console snapshot** | `StorePreset` + `RestorePreset` | undo; same-console save/recall | #5 only |
| **B — Document transfer** | `sendToDisk` / `sendToMixer` | restore without UC in the loop | #6, the one real unknown |
| **C — Parameter replay** | paced, verified `PV`/`PC`/`PS` writes | selective/partial restore; live nudges | #8 `PS` write for labels |

**Tier 0 is the headline, and it is unblocked.** Capture the live tree → emit a
`.scene` → zip it as a `.bak`. Read-only against the console, so zero risk, and it
produces the vendor's own format. That already gives:

- a real backup, in real units, that UC itself can restore
- a diffable record of console state (plain JSON — `git diff` works on it)
- **cross-model migration as a JSON transform**, which is the thing §1.7(3) said
  was impossible on the wire
- an offline test corpus, since a `.bak` is a complete fixture

The honest caveat: restoring a tier-0 artifact initially means handing it to UC's
`restoreBackup`. If UC's restore is itself one of the broken paths, that limits
the value until tier B lands — so confirm which half of UC is failing before
sequencing. Tier 0 is still worth building first either way, because every later
tier consumes the same artifact.

**A is the cheap safety win.** Nearly free, and it fixes the thing C8 complains
about. Do it regardless.

**B closes the loop** — restore without UC. Documents are JSON in real units, the
console validates and converts, transfers are atomic, and
`StoredPreset`/`RecalledPreset` confirm completion.

**C is still wanted**, but it is no longer the backbone. Its remaining jobs are
selective restore ("labels and colours only"), and live adjustment where writing a
whole scene is too blunt.

## 2.2 Backup file format *(tier C, and the portable layer over B)*

Absolute units, semantic keys, device-independent where possible, plus the raw
tree as an opaque archive for same-device restore and forensics.

```jsonc
{
  "format": "studiolive-config-backup",
  "formatVersion": 1,
  "capturedAt": "2026-10-06T14:22:10Z",
  "capturedBy": "studiolive-midi-controller 1.9.0",
  "source": {
    "model": "StudioLive 16R", "deviceName": "Rack 1",
    "serial": "RA1E24090034", "firmware": "...", "sampleRate": 48000,
    "channelCounts": { "LINE":16, "AUX":8, "FX":4, "DCA":8, "SUB":0 },
    "ranges": { "line/ch1/preampgain": {"min":0,"max":60,"units":"gain.0"} }
  },
  "sections": {
    "channels": { "LINE": { "1": { /* below */ } } },
    "buses": { "AUX":{}, "FX":{}, "FXRETURN":{}, "MAIN":{} },
    "dca": {}, "muteGroups": {}, "global": {},
    "routing": {}                     // opt-in, non-portable
  },
  "documents": [                      // tier B, when available
    { "type":"scene", "name":"01.Showfile.scn", "content": { /* JSON */ } }
  ],
  "raw": { "encoding":"ubjson+deflate+base64", "data":"..." }
}
```

A channel entry — note units now come from §1.4 rather than being guessed:

```jsonc
{
  "label": "Kick", "factoryName": "Ch 1",
  "color": "#dc5050", "icon": "kick_drum",
  "link": true, "linkMaster": true,
  "linkOptions": { "ch_gain":true, "pan":true, "fader":true,
                   "dyn":true, "ch_name":true, "ins_fx":false },
  "preamp": { "gainDb":20.0, "phantom":false, "polarity":false,
              "trim":0, "boost10db":false },
  "mono": false,
  "input": { "source":"analog", "index":0, "label":"Analog 1" },
  "processing": {
    "hpfHz": 59.43,
    "gate":  { "on":false, "thresholdDb":-84, "rangeDb":0,
               "attackS":2e-05, "releaseS":0.05,
               "keyfilter":40, "keylisten":false, "expander":false },
    "comp":  { "on":true, "thresholdDb":-13.62, "ratio":1.60,
               "attackS":0.000413, "releaseS":0.0727, "gainDb":2.75,
               "softknee":true, "automode":true },
    "eq":    { "on":true,
               "bands":[ {"gainDb":4.41,"q":0.240,"freqHz":412.3,
                          "on":true,"shelf":false} ] },
    "limit": { "on":false, "thresholdDb":0 },
    "models": { "eq":0, "comp":0, "swapCompEq":0 }
  },
  "sends":   { "aux": {"1":72.0}, "fx": {"A":0} },
  "assigns": { "main":true, "sub":[], "aux":{}, "fx":{} },
  "pan": 50, "stereoPan": 100, "volume": 72.0, "mute": false
}
```

Where a unit is still unknown, store the 0–1 wire fraction alongside and mark it
— those port only between like consoles, and the UI must say so rather than imply
a fidelity we do not have.

## 2.3 Restore pipeline *(tier C)*

Phases, in this order, because §1.7(2):

| # | Phase | Writes | Default |
|---|---|---|---|
| 0 | **Preflight** | none | always |
| 1 | Identity & cosmetics | `username`, `color`, `iconid` | on |
| 2 | Input source | `inputsrc`, `*_src` | **off** |
| 3 | Link topology | `link`, `linkoptions.*`, `linkmaster`, `panlinkstate` | on |
| 4 | Preamp | `preampgain`, `trim`, `digitalgain`, `polarity`, `10db_boost`, then `48v` | on, `48v` **off** |
| 5 | Processing | `opt.*` models first, then `filter.hpf`, `gate.*`, `comp.*`, `eq.*`, `limit.*` | on |
| 6 | Sends & assigns | `aux*`, `FX*`, `assign_*`, `lr`, `sub*` | on |
| 7 | Pan | `pan`, `stereopan`, aux pair pans | on |
| 8 | Levels & mutes | `volume`, `mute` | on |
| 9 | Groups | DCA names/icons/membership, mute-group names/membership | on |
| 10 | **Verify & report** | none | always |

**Phase 0 produces a diff dialog and requires explicit confirmation** — source vs
target identity, per-section change counts, and an itemised list of what will be
skipped and why. If the user does not see that before anything moves, this is no
safer than what it replaces.

**Within a phase:** for a linked pair, write only the odd channel for properties
`linkoptions` says are mirrored. Needs hardware validation.

**Pacing:** batch and throttle. Start at 20–50 writes per 100 ms (~200–500/s),
configurable, then measure. 10,000 writes at 300/s is ~33 s, so progress and
cancel are required.

**Verification:** after each phase, wait for echo quiescence (~300 ms with no
`PV`/`PS`/`PC`), diff intent against `client.state`, compare with an epsilon
(~1e-4) for float32 round-tripping and in native units for anything dB-derived.
Retry mismatches, then record path + both values.

**The report is the product** — a per-parameter account of what was written,
skipped, and refused. That is what UC is not giving him.

## 2.4 Cross-device mapping

- **Channel mapping**: identity by default; explicit table for the rest. Channels
  past the target's count are dropped and listed in the preflight diff.
- **Capability skip**: check the parameter exists in the *target's* tree before
  writing. Absent → skip and record. Cheap, and catches most model differences
  without a capability matrix.
- **Unit conversion**: dB → fraction using the target's published range; §1.4
  units for processing.
- **Routing**: off by default; when enabled, translate through the target's
  `strings` tables, skip and record unmatched names.
- **Model profiles**: do not build a capability matrix up front. Let it accrete
  from real dumps only where skip-if-absent proves insufficient.

## 2.5 UI

Keep this well away from Profiles — a profile is MIDI mappings, a backup is
console state. Conflating them is a mistake users pay for.

- New toolbar group, **Console Config**: "Snapshot to console" (tier A),
  "Back up console…" / "Restore to console…".
- Backup → save dialog → `*.slbackup.json`. Reuse the
  [src/main/preset-paths.ts](src/main/preset-paths.ts) containment check.
- Restore → open → validate → **preflight diff** with per-section checkboxes
  (`48v` and routing unchecked) → progress with phase/counts/cancel → result
  report, exportable.
- **Restore is blocked entirely in Run mode.** Extend
  [src/main/switch-policy.ts](src/main/switch-policy.ts) with `decideRestore`;
  the interlock lives in the main process so a MIDI controller cannot route
  around it.
- Automatic pre-restore snapshot (tier A) plus a pre-restore file backup, always,
  no opt-out.

## 2.6 Work breakdown

| Phase | Work | Effort | Risk |
|---|---|---|---|
| ~~**P0**~~ | ~~**Schema from the artifact.**~~ **Done** — `src/shared/console-config.ts`: document kinds and their roots, `ChannelStrip`, ARGB colour, `iconid` paths, label prefixes, per-root channel counts, EQ band count. Fields that are reasoned about are named; everything else passes through an index signature, so an unrecognised key survives a round trip | — | — |
| ~~**P1**~~ | ~~**Read a `.bak`.**~~ **Done** — `src/main/zip-reader.ts` (no new dependency) + `src/main/console-backup.ts` (classify, parse, summarise) + `tools/inspect-backup.js`. Verified against both reference archives; 109 unit tests | — | — |
| ~~**P2**~~ | ~~**Instrumentation.**~~ **Code done** — `--dump-tree` / `--anonymise` on [tools/hw-probe.js](tools/hw-probe.js), with redaction in `src/shared/state-redaction.ts` (69 tests). **Still needs running against the 16R and 32R** — matrix row G1 | — | — |
| ~~**P3a**~~ | ~~**Author a `.bak`.**~~ **Done** — `src/main/zip-writer.ts` (real CRC-32), `src/shared/console-json.ts` (the console's own JSON style), `src/main/console-backup-writer.ts`. Round-trips both reference archives: 133/133 documents equal, 133/133 bytes identical, `unzip -t` clean | — | — |
| **P3b** | **Capture from the live tree.** The remaining half of tier 0: map live state onto document fields. **Blocked on G1** — see §3.4 | 1–2 d | medium |
| **A** | **`StorePreset`.** Implement + verify via `StoredPreset`. Snapshot-to-console and pre-restore undo | 1–2 d | low |
| **S1** | **Spike: document transfer.** Capture UC doing `sendToDisk` / `createBackup` on the wire | 1–2 d | **decides tier B** |
| **B** | **Document transfer.** Pull/push, fix the `UInt16` chunk sizing, wire up `createBackup`/`restoreBackup` | 3–5 d | gated on S1 |
| **M** | **Cross-model migration.** 16R ↔ 32R as a JSON transform: channel-count mapping, capability skip, EQ band-count differences, routing | 2–4 d | low-medium |
| **C1** | **`PS` write + cosmetics replay.** Labels, colour, icons. Only if `presetChannelNames` doesn't cover it | 1–2 d | `PS` unproven |
| **C2** | **Replay engine.** Phase ordering, pacing, verification, retry, report, preflight diff, UI, Run-mode block | 4–6 d | medium |

**Recommended order: P0 → P1 → P2 → P3 → A, then S1 and branch.**

P0–P1 need no hardware and no console at all — they work against the `.bak`
already in hand. P3 completes tier 0: a real, correct backup written by the app.
A adds undo. That is roughly a week for the whole of the user-visible value.

Then S1 decides the rest. If document transfer works, B gives restore without UC
and M gives migration — and the replay engine (C2) becomes optional polish rather
than the backbone. If S1 fails, tier 0 still stands as a backup-and-migrate
feature with UC as the restore transport, and C1/C2 become the path to
UC-independent restore.

Full feature: ~2–3 weeks, down from the 3–4 in revision 2, because the format no
longer has to be reverse-engineered.

## 2.7 Validation

**Unit** — against checked-in real-tree fixtures (new in Phase 0; the repo has
none today): capture → normalize → round-trip byte-identical; every transform in
§1.7(1) inverts; allowlist rejects every path in §1.8; phase ordering stable;
32→16 drops correctly and 16→32 leaves the remainder alone; dB ↔ fraction across
two published ranges.

**Protocol** — extend the fork's `test/protocolReplay.test.ts`, which already has
a localhost TCP server and packet builders including `buildPSPacket`: `PS`/`PC`/`PV`
writes produce exact bytes; `StorePreset` JSON matches; a paced batch does not
overrun the socket; verification detects an unapplied write.

**Simulator** — if `libstudiolive3simulation.dylib` can be driven standalone
(§1.3), run the whole suite against it before touching hardware.

**Hardware** — new rows in [docs/testing.md](docs/testing.md):
- `G1` Full tree dump succeeds and round-trips (16R, 32R)
- `G2` **`StorePreset` creates a scene on the console**, `StoredPreset` confirms
- `G3` Snapshot → change → recall restores prior state (the undo C8 wants)
- `G4` **`PS` write sets a channel label** — gates tier C cosmetics
- `G5` `PS` write sets `iconid`; colour restore via `PC`
- `G6` Document pulled from console parses as JSON in real units (validates §1.4 on III)
- `G7` Document pushed to console and recalled cleanly
- `G8` Full-section replay to the *same* console, byte-identical re-dump
- `G9` 16R → 32R restore, preflight diff accurate
- `G10` 32R → 16R restore, overflow channels dropped correctly
- `G11` Pacing: no dropped writes at the chosen rate; find where it breaks
- `G12` Restore with Universal Control connected — detect and warn
- `G13` Restore blocked in Run mode
- `G14` Permissions-restricted restore reports refusals rather than failing quietly

## 2.8 Changelog / docs

- `CHANGELOG.md` under `[Unreleased]` — where protocol findings are recorded in
  prose by convention here. The §1.3/§1.4 findings belong there regardless of
  whether the feature ships.
- `docs/usage.md` + `docs/index.html` — a Console Config section, separate from
  Profiles. Note `tests/unit/docs-consistency.test.ts` asserts shipped features
  appear in **both**.
- `docs/testing.md` — the G rows; and update C8's "still no undo" once tier A
  lands.

---

# Part 3 — Prerequisites and unknowns

## 3.1 Do this first: dump a real tree

The repo has **no captured console state at all** — every fixture is synthetic
and the tree type came from a 2021 capture of someone else's console.

`Client.dumpState()` already exists (`Client.ts:169`), returns
`{internal: dumpNode(zlibData), cache: state._data.toJSON()}`, and is unused.
Adding `--dump-tree` to [tools/hw-probe.js](tools/hw-probe.js) is an afternoon
and settles the real writable-parameter count, which parameters publish ranges,
the 16R vs 32R delta, whether the §1.4 parameter names hold on III, and gives a
fixture corpus for offline testing.

Sanitize before checking in: `mixer_serial`, `registered_user`,
`permissions.access_code`, `networksetup.*`.

## 3.2 Spikes, by payoff

1. **`StorePreset`** *(was: unknown whether it existed)* — command id and fields
   confirmed in §1.3; shape inferred from `RestorePreset`. Implement, fire,
   watch for `StoredPreset`. **Gives undo.** Test against the simulator first.
2. **Document transfer** — capture UC performing `sendToDisk` and `createBackup`
   against the 16R. This decides tier B, and therefore the shape of the project.
   Start with the `UInt16` sizing in `parseChunk`, which is the most likely
   existing bug.
3. **The simulator** — can `libstudiolive3simulation.dylib` be driven standalone?
   If yes, hardware-free development for the whole feature.
4. **`PS` write** — only needed if `presetChannelNames` doesn't carry labels.
   Format known; ~10 lines; unproven.
5. **`SynchronizePart`** — partial sync with a `part` field. Would make backup
   refresh cheap.
6. **`PL` (ParamStrList)** — received and unhandled (`Client.ts:430`). Likely
   carries the device-specific source-name lists routing portability needs.

## 3.3 Open questions

**Resolved by the 32R backup (§1.4)** — recorded here so they are not re-asked:
the III document format, its parameter inventory, its units, what a scene does and
does not carry, and the backup archive layout. Also the cause of row C8.

**Still open:**

- What are `StorePreset`'s exact field semantics — does `presetFile` name the
  target slot, and does `presetTarget` scope it the way `RestorePreset`'s does?
- Does `presetChannelNames` on `RestorePreset` mean a recall can carry labels?
  If so, tier C may never need the `PS` write.
- What is the document transfer wire format, and is the `UInt16` sizing in
  `parseChunk` wrong?
- Will the console accept a scene the app authored rather than one it wrote
  itself? Are there checksums, a version field, or required keys? **Test with a
  round-trip: dump → author → restore → re-dump → diff.** This is the main risk in
  tier 0.
- Is `.cnfg` writable the same way `.scn` is, or is project config restored only as
  part of a whole-project operation? `global` lives only there, so it matters.
- Which half of UC is actually failing for the user — backup or restore? If restore
  works, tier 0 ships complete with UC as transport. If restore is the broken half,
  spike S1 moves up. And if the real complaint is the live-state gap above, tier 0
  alone resolves it.
- Does the 32R genuinely have no stored projects, or did UC's backup fail to
  capture them? Distinguishes "UC is working as designed and the design is wrong"
  from "UC is broken".
- `global.mastermixlock` is in `.cnfg` but absent from the library's `GlobalValues`
  type — what else in the type is stale?
- Is there a rate at which the console reliably absorbs writes, and does it
  degrade gracefully or wedge?
- Do linked pairs mirror on write as `setLink`'s `& ~1` implies, and does
  `linkoptions` gate it as expected?
- `PV.ts` notes filter groups use `key\x00\x00\x01` rather than `\x00\x00\x00` —
  does a DCA write need the variant third byte?
- Does `permissions` actually block writes, or only the UC surface? What does
  `SetPresetAccess` gate?
- Is `iconid` portable across firmware, or are icon ids versioned?
- How does `global.scene_safe_*` interact with direct parameter writes as opposed
  to document recalls?

## 3.4 Why capturing from the live tree is blocked on G1

P3a can author a byte-exact archive. P3b — filling one in from a connected
console rather than from another archive — needs one fact that no amount of
offline work will produce: **what scale the live state tree reports a value on.**

The document side is settled (§1.4). A scene stores `volume: -0.566` and
`preampgain: 13.8`, both decibels; `filter.hpf: 24.0`, hertz. The wire side is
not the same. `Client.getPreampGain` computes `min + value * (max - min)` from
the console's published range, so **the wire carries a 0–1 fraction** there. And
`docs/testing.md` records `line.ch16.filter.hpf` arriving as `0.24314` while
Universal Control displayed 59 Hz — another fraction.

What is unknown is whether the **tree** agrees with the **wire**. They are
different encodings of the same console: the tree arrives as UBJSON inside a
`ZB` packet, the wire as a float in a `PV` packet, and `transformers.ts` applies
a *different* table to each (`fromUB` versus `fromPV`). Several parameters have
a `fromPV` entry and no `fromUB` entry at all, which means their tree values pass
through untouched — and if those untouched values are already in real units, then
most of the mapping is the identity function and there is nothing to convert.

That would be a very different piece of work from the alternative, which is
inverting `logVolumeToLinear` — a cubic polynomial fit, invertible only
numerically — for every level in the console.

So the two candidate mappings differ by more than a constant, and picking wrong
is not a visible failure. It is a restored board whose faders are all in
plausible but incorrect positions, and whose preamps are wrong by an amount that
depends on the parameter. Writing it on inference and finding out later is the
expensive order to do this in.

**One dump settles it.** Compare, for the same console in the same state:

```bash
node tools/hw-probe.js --dump-tree          # the live tree
# then in Universal Control: store a scene, create a backup
node tools/inspect-backup.js --channels backup.bak
```

If `line.ch1.volume` reads −0.566 in both, the mapping is identity and P3b is an
afternoon. If the tree says 72.4 or 0.724, it is the polynomial, and the
conversion needs calibrating at several points rather than assumed from one.

Everything else P3b needs is already resolved: the string, colour and icon fields
are identity, booleans are a `0`/`1` coercion, and the float registry in
`console-json.ts` reported no unknown keys across all 202 reference documents.

---

# Part 4 — G1 results, and what they settle

Run against a StudioLive 16R (`192.168.21.41`, firmware 3.4.0) on 2026-10-06.
**11,643 value leaves** in the live tree. These are measurements, not inferences.

## 4.1 A blocking bug in the pinned protocol library

The probe could not connect at all: `Handshake timeout: mixer did not complete
initialization`. The console was answering correctly — a packet trace showed the
complete state tree and a `SubscriptionReply` arriving within 2 s — so the fault
was ours.

`DataClient`'s TCP reframer decided what to do with each segment by testing
`PacketHeader.matches(frame)`, which needs four bytes to say yes. **A segment
ending with one to three bytes of the next packet's header matched nothing, had
no outstanding byte count, and was discarded** as an unrecognised header. Every
later packet was then read at the wrong offset, and the packets lost included the
`SubscriptionReply` the handshake waits for — so the connection failed with a
timeout that said nothing about the cause.

Reproduced live: a segment arrived carrying exactly `55 43`, which is `UC`, the
first half of a header. Four desync errors in one handshake.

It needs a large packet to be likely, which is why it surfaces on this console
now: with two projects stored, the state tree is 19 KB compressed across two `CK`
packets, followed by an 8 KB `BO` — enough segments for a boundary to land inside
a header. A console with nothing stored may never trip it, which is consistent
with the 16R having passed rows C1–C6 previously.

Fixed in the fork by accumulating into a carry buffer and consuming only complete
packets, so nothing is ever discarded for being incomplete, plus resynchronising
on the next header rather than flushing everything. Nine new regression tests;
all nine fail against the original implementation. After the fix the same console
connects in 1.7 s with correct channel counts.

**This is not specific to the backup work — the app itself cannot connect to this
console without the fix.** It needs a release of the fork and a pin bump.

## 4.2 A leak in the redactor, found by using it

The first real dump wrote the console's serial, its registered owner and its
device name into the file, and reported `redacted fields: 0`.

Every rule was anchored on the logical path (`global/mixer_serial`), and every
real path has a structural segment in the middle
(`internal/children/global/children/mixer_serial`). Nothing matched. The
synthetic test fixtures had been written to the logical shape, so they passed.

Fixed by stripping the structural segments — `children`, `values`, `ranges`,
`strings`, `states` — before matching, with the regression test built from the
real dump's shape rather than an idealised one. The same dump now reports 12
redacted fields and contains neither the serial nor the IP.

The general lesson is in the first sentence: a redactor that silently matches
nothing looks exactly like a redactor that works. Both failures here were of that
shape.

## 4.3 The scale question, answered — and it closes off P3b

**Every numeric parameter in the live tree is a normalised 0–1 fraction. The
document stores real engineering units.** Measured on the same console:

| Parameter | Live tree (raw UBJSON) | Document |
|---|---|---|
| `volume` | `0.8461538553237915` | dB |
| `preampgain` | `0.3333333432674408` | dB (× 60 = 20 dB ✓) |
| `pan` | `0.5` | 0–1 |
| `aux2` send | `0.06599999219179153` | dB |
| `filter/hpf` | `0.24313688278198242` | Hz |
| `gate/threshold` | `0.14068439602851868` | dB |
| `gate/release` | `0.000003155024160150788` | seconds |
| `comp/threshold` | `0.756862998008728` | dB |
| `comp/ratio` | `0.395222544670105` | ratio |
| `eq/eqfreq1` | `0.134745791554451` | Hz |
| `eq/eqq1` | `0.18713966012001038` | Q |

The transformed view is no better: `transformersUB` turns `volume` into the 0–100
"pseudo-intensity" scale (`0.846` → `84.6`), which is not dB either.

So authoring a document from live state needs a conversion for **every** value,
and the curves differ per parameter.

**The console does not publish them.** Of 9,887 value leaves, 425 carry a range —
and 191 of those are routing source selectors (`mix1_src`, `avb1_src`, with units
`analog_source` / `digital_source`), which are enum indices. **`preampgain` is the
only continuous audio parameter that publishes a range anywhere in the tree.** Not
volume, not pan, not sends, not HPF, EQ, compressor, gate or limiter.

### What this means

P3b as scoped — fill a scene document from the live tree — would require
reverse-engineering roughly fifteen conversion curves (fader taper, send taper,
HPF and EQ frequency, EQ gain and Q, four compressor parameters, four gate
parameters, limiter threshold) with no published metadata, each needing hardware
calibration at several points, per model. The existing calibration note in
`docs/testing.md` took two datapoints for one parameter.

That is a project in its own right, and the payoff is a document the console can
already produce correctly by itself.

**So P3b should not be built as specified.** The architecture that follows from
this data is:

1. **Tier A (`StorePreset`) becomes the primary backup mechanism, not just undo.**
   Ask the console to write the scene; it applies its own conversions. This is now
   the highest-value unbuilt item.
2. **Tier B (document transfer)** carries the result off the console. Together,
   A + B is a complete backup and restore that never needs a conversion curve.
3. **Tier 0 keeps its value** for reading, diffing, migrating and authoring
   archives — all document-to-document, all in real units already.
4. **A live-tree capture is still worth building for cosmetics only** — `username`,
   `iconid` are strings and `color` is an integer, so those are identity mappings
   with no curve. Labels, colours and icons were the top of the original request,
   and they are reachable without any of the above.

Revision 3 said the remaining unknown was "only the transport". That was right,
and this is why it matters: the transport is not a convenience over authoring
documents ourselves, it is the thing that avoids needing fifteen calibration
curves.

## 4.4 Incidental findings

- `color` arrives from UBJSON as a **BigInt** (type `L`, int64BE), e.g.
  `4294770098n`, not the int32 the library's `fromUB` transform assumes first.
- Channel labels on the live console carry the `N:` index prefix (`1:Piano`,
  `2:Keys`) exactly as the documents do.
- 16R shape confirmed: LINE 16, AUX 6, FX 2, FXRETURN 2, RETURN 1, TALKBACK 1,
  MAIN 1, DCA 8, **SUB 0**, MASTER 0, MONO 0.
- The dump is 322 KB of JSON for 11,643 leaves.
- `preampgain`'s published range is
  `{min: 0, max: 60, def: 0, units: "gain.0", curve: "linear", mid: 1}` — note
  `mid`, which the library's type declares but never reads.

## 4.5 Matrix rows settled

- **G1 — state tree dumps and the redaction holds: ✅ 16R.** Two bugs found and
  fixed in the process (§4.1, §4.2). Not yet run on the 32R —
  `192.168.20.207` did not answer on port 53000.
- **G2 — tree covers every field a scene carries:** structurally yes, but the
  values are on the wrong scale, so the answer that matters is §4.3.

---

# Part 5 — Tier A verified on hardware

Run against the 16R (`192.168.21.41`, firmware 3.4.0.111374) on 2026-10-07.

## 5.1 `StorePreset` exists and works

The symmetric payload, inferred in §1.3 from the string table, is correct:

```
->  {id:"StorePreset", url:"presets", presetTarget:"", presetTargetSlave:0,
     presetFile:"presets/proj/02.Camp Evo.proj/02.APITest.scn"}
<-  {id:"StoredPreset", presetFile:"...", presetName:"APITest",
     presetType:"scn", url:"presets"}
```

Confirmed in 3.2 s; the scene then appeared in the project listing with its
title taken from the filename. `presetName` and `presetType` come from the path,
so naming is done by choosing the slot.

Implemented in the fork as `storePreset` / `storeProjectScene` / `storeProject`,
resolving on the `StoredPreset` notification rather than returning immediately —
a store that silently did nothing would otherwise be indistinguishable from
success. **Matrix row G3: ✅ 16R.**

## 5.2 Snapshot plus recall gives undo

**Matrix row G4: ✅ 16R.** Snapshot, change `mute` and `polarity` on one channel,
recall the snapshot: both reverted, and the console was left as found.

So tier A delivers the undo that row C8 records as missing, and it is cheap.
A restore should take a snapshot first, unconditionally.

## 5.3 The finding that matters most: read-back through the library lies

The undo test failed twice before it passed, and both failures were measurement
artifacts rather than console behaviour.

`setSwitch` and `_setLevel` seed the local cache immediately after writing,
because the console's echo lags. **`setMute`, `setSolo`, `setLink`, `setPan` and
`setColor` do not.** So reading a value straight back through the same client
returns whatever the console last echoed, which after a write is the *previous*
value. Both "failures" were that: the console had done the right thing and the
cache had not caught up.

This is a direct hazard for §2.3, which proposes verifying a restore by diffing
intent against `client.state`. **That design would report false failures, retry
writes that already succeeded, and declare a correct restore broken.**

Verification must therefore not trust the library's cache. Either:

- wait for the console's `PV`/`PS`/`PC` echo for each written path and compare
  that, rather than reading the cache at an arbitrary moment; or
- re-sync and compare against a fresh state tree, which is what the rigorous
  test did — every measurement on a new connection, since a new connection
  brings a new `Synchronize`.

The second is slower and unambiguous; the first is what a progress UI needs.
A restore probably wants both: echo-based progress, and a fresh-sync diff at the
end for the report.

Worth fixing in the fork too, so the setters are consistent about seeding.

## 5.4 Corrections to earlier parts of this document

- **§1.7(5) overstated the scene filters.** This console has `fltrpreamps = 0`
  and `fltr48v = 0`, with every other `fltr*` flag at 1, and `polarity`
  nonetheless reverted on recall. The flag values are real, but there is **no
  evidence here that they gated the recall**, and an earlier draft of this
  section claimed they explained a failed undo. They did not; a stale cache did.
  Treat the filters as an open question (§3.3), not a known constraint.
- Excluding preamps from a scene recall is normal live-sound practice, so
  `fltrpreamps = 0` is likely deliberate on this console and should not be
  "corrected" by the app.

## 5.5 Console state left behind

Two scenes were created during testing and **are still on the console**, because
the library has no delete (`DeletedPreset` exists in the protocol and is not
implemented):

- `02.Camp Evo.proj / 02.APITest.scn`
- `02.Camp Evo.proj / 03.UndoTest.scn`

Both are snapshots of the board as it already was, so neither is harmful, but
they are clutter and should be deleted from the console's own preset browser.

Also, **the loaded-scene pointer changed** from `01.New Scene.scn` to
`03.UndoTest.scn` as a result of the recall. The live settings are unchanged —
`03.UndoTest.scn` was a snapshot of exactly that state, and mutes and polarity
were verified back to their original values. Recalling `01.New Scene.scn` to
restore the pointer would apply that scene's *stored* state, which may be older
than the current board, so it is deliberately not done here.

A `deletePreset` wrapper is the obvious next small addition, both to clean up
after tests and because any backup UI that can store will be expected to delete.

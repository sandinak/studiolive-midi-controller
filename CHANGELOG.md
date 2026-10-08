# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Backup and restore in the app.** 🗄️ Console in the header, kept deliberately separate from Profiles in the UI as well as the code — a profile is this app's MIDI mappings, a console backup is the console's own scenes, projects and presets, and conflating them is a mistake users pay for. Backup reads the console and writes a Universal Control-compatible archive, warning when the console has no stored project and the archive therefore holds only the factory library. Restore shows a plan before writing anything: every slot it would create, every slot it would **replace** with the current occupant named, and a confirmation box that must be ticked before anything is replaced. The plan is held in the main process between planning and applying, so the renderer cannot hand back something it has edited. Restore is refused in Run mode — it is the most destructive thing the app can do and the interface is locked because somebody is mid-performance; backup stays available in both modes, since capturing the board as it stands during a show is exactly when you want to. Inspect opens an archive and reports what is in it with no console involved.

- **Restore a backup to a console.** `node tools/restore-console.js <mixer-ip> <backup.bak>` — **dry run by default**, printing every slot it would create and every one it would overwrite, with the current occupant's name. It writes nothing without `--apply`, and refuses to replace an existing document without `--allow-overwrite` on top of that. Replacing a stored document is irreversible without another backup, so the destructive step has to be asked for twice and in the caller's own source. Planning and execution are separate functions and the plan is required as input, so there is no path that writes without having first worked out what it would write. The factory channel and FX presets are skipped unless asked for: they are identical on every console, account for most of the transfer time, and are almost never what a restore is for. Verified end to end against a 16R — restored a document and read it back semantically identical both to what was there before and to the archive it came from, with the rest of the console untouched.
- **Upload of any size, and the flag that makes it work.** The 4096-byte wall was not a wall. The 14-byte `FD` header carries a more-follows flag at bytes 10–11 — 1 on every chunk but the last, 0 on the last — and the console commits the file as soon as it sees a zero there. Sending zero on every chunk, as the first attempt did, stored only the first chunk and replied `StoredPreset` immediately: success-looking and silently truncated. The capture showed it plainly, with `StoredPreset` arriving 0.8s after the first chunk and 0.7s before the second was sent. Found by dumping the console's own download headers side by side. Verified on all four document types, byte-identical round trips: a scene at 82,627 bytes and a project config at 49,102 across multiple chunks, a channel preset at 516 bytes and an FX preset at 160 in one. The encoder path works too — download, decode, re-encode with our own UBJSON encoder, upload, download again, stored byte-identically and semantically identical to the original — so documents can be authored rather than only copied.

- **Back up a console without Universal Control.** `node tools/backup-console.js <mixer-ip>` enumerates every document the console stores, downloads each one, and writes a UC-compatible `.bak`. Verified against a 16R: 69 documents in 33 seconds, the same set UC produces with nothing missing and nothing extra, and **69 of 69 semantically identical to UC's own archive**. None are byte-identical, by design — the console prints more decimal places for a float than JavaScript does, so the JSON text differs in the last digits while every value is the same. Two consecutive runs are byte-identical to each other. Read-only against the console; it only ever downloads. This matters because UC's backup will report success and write a plausible archive while holding no connection to the console at all.
- **The capture takes an injectable transport**, so enumeration, path mapping, progress and failure handling are testable without a console on the network — which matters when the alternative is testing against hardware with real shows on it. It also does its own directory listing rather than using the library's `sendList`, because that helper filters out `.cnfg` entries and a project config is the only document carrying `global`: filtering it would produce an archive silently missing sample rate, DCA and pan mode, and the scene-filter flags. A document that fails to download is recorded and the rest continue, since a backup that omits one unreadable preset and says so is worth far more than no backup.

- **Document transfer: download, upload and delete.** The file-request verbs, recovered from Universal Control's binaries where they are little-endian uint32 immediates rather than readable strings — `ZRtr` appears as `rtRZ`, which is why an earlier search found nothing. They are FTP command names, which makes the set legible: LIST, RETR, STOR, DELE, RNFR, with a `Z` prefix for the zlib-compressed variant. Verified against a 16R: `ZRtr` downloads any size, `Dele` deletes and leaves neighbouring slots alone, and `ZStr` uploads — a channel preset round-tripped byte-identically, 516 bytes of UBJSON, 354 compressed, uploaded, downloaded, identical. **Upload is limited to one 4096-byte packet.** The console caps an `FD` payload there and ends the transfer; a single packet declaring more is stored at the declared length with everything past byte 4096 garbage, and chunking keeps only the first chunk however the header is framed. So channel and FX presets transfer today and scenes do not, since those compress to 4,501–7,021 bytes.
- **Two bugs that silently destroyed transferred data.** `handleFDPacket` ran `JSON.parse` on the reassembled payload and returned only the parsed result — fine for a directory listing, fatal for a document, which is compressed UBJSON: the parse threw, the result became `undefined`, and the transfer completed and then vanished. The raw bytes are carried alongside now, and the `FileData` listener forwards both rather than dropping them a second time. And `parseChunk` read `bytesRead` and `totalSize` as 16-bit each followed by an "unknown" pair; those cannot be told apart from single 32-bit fields while the values stay small, and they have, because documents travel compressed. Now read as 32-bit.

- **The console's document download protocol, decoded.** Captured Universal Control taking a backup and decoded it. One `FR` request per document, with a verb the project had not seen — **`ZRtr`** — answered by `FD` chunks of 4096 bytes. 69 documents in one backup. The console path namespace maps straight onto the archive layout: `presets/channel/` becomes `Fat/`, `presets/fx/` becomes `FX/`, `presets/scene/` becomes `Scene/`, `presets/proj/<p>/` becomes `Project/<p>/`.
- **The console's native document format is UBJSON, not JSON.** The JSON in a `.bak` is Universal Control's own re-serialisation on the way to disk. On the wire a scene is zlib-compressed UBJSON: `01.Starting.scn` moves as 5,195 bytes, is 82,831 bytes of UBJSON, and 131,134 bytes as the JSON UC writes. That also retires an earlier worry — the library's `UInt16` read of `FD`'s size field was predicted to overflow on a ~110 KB scene, and does not, because every transfer in the capture was between 354 and 7,021 bytes compressed. Still the wrong width, no longer a blocker.
- **A complete UBJSON codec**, `src/shared/ubjson.ts`. The protocol library's reader implements only the subset the state tree happens to use and throws `Unknown type 73` on a real preset document — that is `I`, int16. It also assumes every string and key length is a one-byte `i`, which holds only while keys stay under 128 bytes. This handles every UBJSON value type and integer-typed length prefixes, and it **encodes**, which nothing in the library does; the encoder is what pushing a document back to a console will need, since the console speaks UBJSON. Validated against every document in a real transfer, not a sample: 69 of 69 decoded, 69 of 69 round-tripped through the encoder, 69 of 69 semantically identical to UC's archive entry, and 69 of 69 re-serialised to JSON structurally identical to UC's own output. The JSON serialiser written earlier turns out to be exactly the step UC performs.
- **A UCNet traffic decoder**, `tools/ucnet-decode.js`, which is how all of the above was established.

- **`StorePreset` — the console can be asked to write its own state.** Recovered from Universal Control's string table, where it sits immediately before `RestorePreset` and shares its field names; the symmetric payload turns out to be exactly right. Verified against a 16R on firmware 3.4.0.111374: the console confirms with a `StoredPreset` notification carrying the file, name and type, in 3.2 s, and the scene then appears in the project listing. This matters more than an extra command — the console stores documents in real engineering units while every numeric parameter on the wire is a normalised 0–1 fraction, and it publishes a usable range for exactly one continuous audio parameter out of 9,887, so asking the console to serialise itself is the only way to get correct values out of it without reverse-engineering a conversion curve per parameter. It resolves on the confirmation rather than returning immediately: a store that silently did nothing would be indistinguishable from success, and the point of a snapshot taken before a destructive change is being able to rely on it.
- **Snapshot and recall give undo**, which the hardware matrix recorded as missing (row C8). Verified end to end on a 16R: snapshot, change mute and polarity on one channel, recall, both reverted, console left as found. A restore should take a snapshot first, unconditionally.

- **Backup archives can be written, not just read.** A ZIP writer with a real CRC-32, a serialiser that reproduces the console's own JSON layout, and an archive builder that assembles the vendor's directory structure. Validated end to end against both reference backups: read, re-emit, re-read — 133 of 133 documents equal, 133 of 133 byte-identical, and the output passes an independent extractor. The CRC implementation has a stronger check than any unit test could give it: it was verified against the checksums the vendor itself stored in those archives, 133 entries, zero mismatches.
- **The serialiser matches the console's number formatting, which `JSON.stringify` cannot.** Measured on a real 16R scene: 3,965 of 4,429 numeric literals change their printed form under a JavaScript round trip. Most of that is precision — the console prints the full decimal expansion of a float32 where JavaScript prints the shortest form that round-trips as a double, and both narrow back to the same float32, so it is safe to lose. The part that is not safe is float-ness: the console writes `130.0` and `-84.0`, and `JSON.stringify` writes `130` and `-84`, because JavaScript has a single number type. A reader that expects a decimal point where the schema says float would reject that, and a backup is the wrong place to discover whether the console's parser is that reader. Which keys are float-typed was derived by scanning the *printed* form of every numeric literal across 202 real documents, so it is observation rather than a guess, and the serialiser reports any key it had to treat as a float without knowing about it. An empty object is written as a block with a blank body too, matching the `"opt": \n{\n\n}` in real scenes — there is not a single bare `{}` anywhere in one. All six document types now re-serialise structurally identical to the console's own output.
- **Documents being copied are passed through as original bytes.** Re-serialising is numerically lossless and textually not, and nothing is known to depend on the difference — which is exactly why a backup should not introduce it for a document it is only copying. An entry supplies either bytes or a document to serialise, never both.
- **The probe can dump the console's live state tree.** `node tools/hw-probe.js --dump-tree` writes everything the console publishes to a JSON file and reports the root list, the leaf-parameter count, and which parameters carry a published range. Nothing in this project had ever captured one: the protocol library's state-tree type was generated from someone else's console in 2021 and is already missing parameters that appear in real documents, and every test fixture here is synthetic. A dump from each model is the prerequisite for authoring a backup from live state, which is the next piece of work.
- **State dumps are redacted before they are written, not after.** The raw tree carries the console's serial, its registered owner, its network configuration and its remote-access code, and an unredacted file is one somebody will attach to an issue. `users`, `permissions` and `networksetup` are dropped wholesale rather than field by field, so a firmware update that adds a field to one of them does not leak it the first time a dump is shared; device identity and recording-session metadata are replaced in place, keeping the key so a reader can still tell the parameter exists. `--anonymise` additionally strips channel labels, DCA and mute-group names and loaded scene names, which is required before committing a dump as a fixture because labels on a working board name the people standing behind them. The probe says which it did, and warns when labels are still present. Firmware version, published ranges, colours, icons and levels are deliberately kept — they are the diagnostically useful part.
- **Console backup archives can be read.** `tools/inspect-backup.js` opens a Universal Control `.bak` and reports what is actually inside it: document counts, the shape of the console that wrote it, the projects and scenes it holds, and with `--channels` every channel's label, colour, icon, fader and gain. Read-only, and it needs no console on the network. This is the first half of a backup/restore feature planned in `docs/config-backup-restore-plan.md`; it ships first because it is independently useful for working out why a backup is not what its owner expected.
- **The console's own document format, decoded.** A `.bak` is a ZIP of JSON documents. Dissecting two real archives — a 16R and a 32R, 133 documents — settled a set of things that had only been guessed at. **Values in documents are in real engineering units**: fader positions and preamp gain in dB, EQ and high-pass frequencies in Hz, attack and release in seconds. The wire protocol reports those same parameters as bare 0–1 fractions with no published range, which is why calibrating one previously meant setting a value from the app and reading the result off Universal Control's display. **Channel colour is an unsigned 32-bit ARGB integer** — `4278190335` is `#0000FF` — with `0` meaning unset rather than black; note this is a different byte order from the protocol library's own colour transform. **`iconid` is a structured `category/name` path** (`keyboards/piano`, `other/iem`), not the free-form string the renderer's keyword matcher assumes. And the EQ band count is channel-type dependent: four bands on an input, six on an aux, so nothing may assume it.
- **Why a channel preset recall changes so little.** Last release corrected the documentation after testing showed recall rewrites EQ, compressor, gate and the high-pass filter but never preamp gain, phantom power or polarity. The archive explains it: a `.channel` document contains exactly `filter`, `gate`, `comp`, `limit` and `eq`. Gain, phantom, polarity, label, colour and icon are not in the file at all, so no recall could ever have touched them. The observation now has a mechanism, and `DOCUMENT_ROOTS` in `src/shared/console-config.ts` pins it.
- **Three document types, and only one of them carries `global`.** A project is a `.cnfg` plus one or more `.scn` scenes, and a standalone `.scene` is a third shape. Their scopes differ: sample rate, DCA and pan mode, the scene-filter flags and `mastermixlock` appear **only** in a project config, so a scene on its own is not a complete capture of a console. Worth knowing before treating any single document as a backup.
- **A minimal ZIP reader**, `src/main/zip-reader.ts`, rather than a new runtime dependency. Node ships no ZIP support; the alternatives were another package in a tree that already carries nine advisory overrides, or shelling out to `unzip`, which does not exist on Windows. It reads a backup file the user chose, so it is written as untrusted-input parsing: every offset is bounds-checked, per-entry and whole-archive uncompressed sizes are capped, `inflateRaw` is given an output limit so a decompression bomb is refused during inflation rather than after allocating it, and entry names that could escape a directory are rejected at the parse boundary. ZIP64, encryption and multi-disk archives are refused with a reason instead of being misread.

### Fixed
- **Verification cannot read values back through the library.** `setSwitch` and `_setLevel` seed the local cache immediately after writing, because the console's echo lags; `setMute`, `setSolo`, `setLink`, `setPan` and `setColor` do not. So reading a value straight back through the same client returns whatever the console last echoed, which after a write is the *previous* value. This produced two false negatives while testing undo — the console had done the right thing both times and the cache had not caught up — and it is a direct hazard for the restore design in the plan, which proposed diffing intent against `client.state`. That would report false failures, retry writes that had already succeeded, and declare a correct restore broken. Verification must compare against the console's own echo per path, or against a fresh state tree; the plan now says so, and the inconsistency is worth fixing in the fork so the setters all behave the same way.

- **State dumps were not actually redacting anything.** The first dump taken from a real console wrote its serial, its registered owner and its device name into the file, and reported "redacted fields: 0". Every rule was anchored on the logical path — `global/mixer_serial` — and every real path has a structural segment in the middle, `internal/children/global/children/mixer_serial`, so nothing matched. The synthetic fixtures had been written to the logical shape, which is why they passed. Fixed by stripping the structural segments (`children`, `values`, `ranges`, `strings`, `states`) before matching, with the regression test built from the real dump's shape rather than an idealised one; the same dump now reports 12 redacted fields and contains neither the serial nor the IP. Worth stating plainly, because both bugs found during the first hardware run were this shape: **a redactor that silently matches nothing looks exactly like a redactor that works.**
- **Two channel-count limits that a 32R exceeds.** The archive shows that console reporting 24 DCA groups and 4 subgroups, where the renderer hard-codes eight of each and always fetches exactly eight. Not yet fixed in the UI, but now measured and recorded rather than suspected; `documentChannelCounts()` reads the real shape from a document instead of assuming one.
- **Gaps in the protocol library's state-tree type.** `sub`, `mapping` and `global.mastermixlock` all appear in real documents and are absent from the hand-transcribed `ZlibPayload`, which was generated from a capture of a console without subgroups. This is why the new document types name the fields that are reasoned about and carry everything else through an index signature: a backup that silently dropped an unrecognised key would lose configuration nobody could get back.

### Known issues
- **The app cannot connect to a console with stored projects until the protocol library is re-released.** A StudioLive 16R with two projects saved fails every connection attempt with "Handshake timeout: mixer did not complete initialization", while the console answers correctly — the whole state tree and a `SubscriptionReply` arrive inside two seconds. The fault is in the pinned library's TCP reframer: it decided what to do with each segment by testing `PacketHeader.matches()`, which needs four bytes to say yes, so a segment ending with one to three bytes of the next packet's header matched nothing, had no outstanding byte count, and was discarded as an unrecognised header. Every later packet was then read at the wrong offset, and the ones lost included the `SubscriptionReply` the handshake waits for. Reproduced live: a segment arrived carrying exactly `55 43` — `UC`, the first half of a header. It takes a large packet to be likely, which is why it surfaces on a console with content stored; the state tree there is 19 KB across two `CK` packets followed by an 8 KB `BO`, enough segments for a boundary to land inside a header. Fixed on the `fix/tcp-header-straddle` branch of the API fork with nine regression tests — all nine fail against the current release — and verified against the same console, which then connects in 1.7 s. **Shipping the fix needs a fork release and a pin bump in `package.json`.**

### Security
- **Electron 44.0.0 → 44.3.0.** Patch releases on the runtime that ships inside the app, so its fixes are the ones that reach users. Verified with the full suite, all 15 screenshot scenes, and a real electron-builder package with the native modules rebuilt.

### Changed
- **`@types/jest` 29 → 30**, matching the jest 30 already in use; the types had been left a major behind, and `@types/node` to the 26.5 line.
- **CI actions to v7 and `softprops/action-gh-release` to v3.** `setup-python` was the one action still on its old major after the earlier sweep. The release-upload action's v3 is purely a Node 20 → 24 runtime move, which clears the last "Node.js 20 is being deprecated" warning the release workflow was emitting on every run.
- **Dependabot will stop proposing TypeScript majors.** 7.x is the native compiler and ts-jest cannot consume it — every suite fails to *run*, while `tsc --noEmit` passes — so adopting it means carrying two TypeScript packages side by side. That is a migration to plan, not a dependency bump, and TypeScript never leaves the build machine. Minor and patch updates still come through, and the reasoning now lives in `.github/dependabot.yml` rather than only in a closed PR thread.
- **CI runs the tests and the UI harness on all three platforms.** Both jobs were `ubuntu-latest` only, so macOS and Windows — both of which this project ships — were never exercised by automation; Windows had been released for several versions on the strength of "it compiles". They are now a matrix across ubuntu, macos and windows with `fail-fast` off, and the screenshot artifacts are per-OS so the three renderings can be compared. This is what catches cross-platform rendering differences: the Linux system font is wider than the macOS one and silently truncated channel labels through a release, found by eye rather than by CI.
- **`copy-assets` is a Node script instead of a shell pipeline.** `mkdir -p` and `cp` do not exist on Windows, which is why `npm run build` could not run there and why the release workflow's Windows job reimplemented every build step by hand in bash. One implementation now serves all three platforms, and that duplicated block is gone.

### Fixed
- **Overstated what a console preset recall changes.** The confirm dialog, the usage guide and the docs site all said recall "replaces the entire channel strip — gain, EQ, compressor, gate and limiter". Testing it against a StudioLive 16R for the first time showed the scope is narrower: across four different presets it rewrote EQ, compressor, gate and the high-pass filter, and never touched preamp gain, phantom power or polarity. The warning erred toward making the feature sound more destructive than it is, which is the safer direction to be wrong in, but it was still wrong in text users read before confirming. Corrected everywhere it appeared.
- **Tests failed on a CRLF checkout.** The first run of the new matrix caught it: a docs-consistency assertion extracted a fenced block with a regex anchored on `` ```\n ``, which does not match the `` ```\r\n `` that Windows checkouts produce under `core.autocrlf`. The `?? ''` fallback then reported a missing substring rather than the real cause. Fixed at the call site and at the root — `.gitattributes` now pins the working tree to LF everywhere, since several suites read project files and match against them.

## [1.8.0] - 2026-09-10

### Security
- **Fixed the one vulnerability that reached users.** `brace-expansion` below 1.1.18 (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 — DoS via unbounded expansion), pulled in through `presonus-studiolive-api` → `bunyan` → `mv` → `rimraf` → `glob` → `minimatch`. It was the only finding in `npm audit --omit=dev`, which now reports none. The override is scoped to the 1.x line because the tree also carries 2.x and 5.x copies that a blanket override would have dragged backwards. Reachability was thin — it needs attacker-controlled glob patterns reaching bunyan's log rotation, which this app never exposes — but it is what shows up in a user-facing audit.
- **Electron 43 → 44** (Chromium 152, Node 24.18.1). Electron ships inside the app, so its advisories are the ones that actually reach users. All three of its breaking changes were checked and none apply: 32-bit builds are gone but nothing published targets ia32 or armv7l, Unity desktop support is unused, and `openAsHidden` appears nowhere in `src/`.
- **Build-tooling advisories pinned out** — `@xmldom/xmldom`, `fast-uri`, `js-yaml`, `tar`, and both the 6.x and 7.x lines of `undici`, all transitive with no direct parent to bump. `brace-expansion` needed three separate floors (1.1.18, 2.1.4, 5.0.9) because the tree carries all three major lines and each had its own advisory; a single override would have dragged consumers across a major boundary. `npm audit` now reports **0 vulnerabilities** across the whole tree, dev included. None of these ever leave the build machine, but electron-builder was re-run afterwards to confirm the `tar` and `js-yaml` bumps did not disturb packaging.

### Added
- **About dialog.** Clicking the app icon in the header shows the version, author, licence, the pinned mixer-API tag, and the Electron/Chromium/Node versions — the things worth quoting in a bug report — plus links to the changelog, an update check, and the issue tracker. The values come from the main process reading `package.json`, so they cannot drift from what actually shipped.
- **The channel switches and preamp gain are MIDI-mappable.** `Mixer Action` in the mapping dialog gains **Preamp Gain (dB)** and **Channel Switch…**, the latter with a second dropdown for which switch. Switches behave like mute and solo — a CC crossing the threshold or a note on/off — so they reuse the existing threshold and invert settings. Gain scales across the console's range and defaults to the full 0–60 dB; narrowing it per mapping is worth doing, since otherwise a controller sweep reaches +60 dB at the top of its travel. The Run-mode locks are enforced in the main process for MIDI exactly as for the UI, so a controller sending the wrong note cannot flip phantom power mid-performance.
- **Preamp gain, in decibels.** A gain slider in the channel menu, labelled with the range the console publishes for itself (0–60 dB on a StudioLive III) rather than a hard-coded one. The wire value is a 0–1 fraction of that range, so a raw reading of `0.282` is really 16.9 dB; the conversion now comes from the console's own metadata. Written on slider release rather than on every movement, so dragging does not flood the console. Edit mode only — gain is a setup control, and the one change in this menu that can cause feedback.
- **Console channel presets in the channel menu.** Lists the preset library stored on the mixer — 51 factory presets across Drum, Guit, Vocal, Keys, Perc, Brass and Wind — with the ones matching a channel's instrument listed first and highlighted. The match reads the channel's icon id, which the console publishes as a free-form string with no fixed vocabulary (both `keyboards/piano` and a bare `piano` occur), so it matches on instrument keywords rather than a path prefix, and it only reorders the list — every preset stays reachable whatever a channel's icon says. Recall replaces the entire strip, so it confirms first and is Edit mode only.
- **Per-channel settings menu.** Clicking a channel's instrument icon opens phantom power, polarity, sum-to-mono, and the gate / compressor / EQ / limiter in-out switches, read live from the console and written straight back. A switch the mixer has not reported shows as *unavailable* rather than as off, so an unknown state is never mistaken for a known one.
- **Safety gating on the destructive switches.** Phantom power and polarity are refused while the app is in Run mode, and enabling 48V asks for confirmation even in Edit mode (turning it off never does — that is the safe direction). Phantom power can damage ribbon microphones, and an accidental polarity flip on a summed source is a silent way to gut the low end mid-set. The processor switches stay live in Run mode, because bypassing a compressor during a performance is both normal and instantly reversible. The lock is enforced in the main process, which mirrors the renderer's mode, so a stale window or stray IPC cannot flip phantom power during a show — greying out the control is the hint, not the guard.
- **`presonus-studiolive-api` 1.10.0.** Adds `getSwitch()` / `setSwitch()` for the per-channel switches, `getPreampGain()` / `setPreampGain()` in decibels, and `getParameterRange()`, which exposes the min/max/units the console publishes in its state dump. All of these parameters were readable through the state tree but had no setter, so writing one previously meant reaching into the library's private `_sendPacket`. `setPreampGain` clamps to the console's range rather than passing an out-of-range float through, because that particular mistake is a very loud one. Paths verified against a StudioLive 16R, including the nested ones such as `line/chN/limit/limiteron`.
- **The channel settings menu is now on the documentation site.** README and the usage guide covered it; `docs/index.html` did not mention it at all.
- **The annotated main-window screenshot is generated too.** Scenes can now declare numbered callout badges (`annotate:` in `tools/screenshot/scenes.js`), drawn into the page before capture. `main-window-annotated.png` had been hand-annotated at v1.1.0 and drifted six versions behind the UI it described, with callout numbers that no longer matched the legend beside it on the docs site. Both are now in step, and the legend text was corrected to describe what those regions actually contain.
- **Documented the yarn build requirement.** The pinned `presonus-studiolive-api` dependency builds itself during `npm install` and its build script invokes yarn, so a machine without it fails `npm ci` with `sh: 1: yarn: not found`. GitHub's x64 runner images happen to ship yarn, which is why this never surfaced in CI. Now called out in the README and both setup docs, and made explicit with `corepack enable` in the Linux CI jobs.
- **Linux build support** (packages not published yet — see below). electron-builder now produces an AppImage, a `.deb`, and a tarball for x64 and arm64, via `make dist-linux` or the new `build-linux` job in the release workflow. A single x64 host emits both architectures: nothing is compiled during a Linux build, because Electron is downloaded prebuilt and `@julusian/midi` — the only native dependency that ships — is a prebuildify package carrying `linux-x64`, `linux-arm64`, and musl binaries in its tarball. The `.deb` is the one target that needs a Linux host, since electron-builder shells out to `fakeroot`/`dpkg-deb`; it declares ALSA as a `libasound2 | libasound2t64` alternative so it installs on both sides of the Debian `time_t` transition. No main-process changes were needed — the platform branches for icon path, dock icon, and `window-all-closed` already handled non-macOS. Verified end to end on a Debian 11 host, and the `build-linux` job runs on every release as a build check. The packages are deliberately **not attached to this release**: the Linux UI has only ever been exercised headlessly under xvfb, and ALSA MIDI has never been tested against real hardware. Linux ships when that verification exists. Building the `.deb` also required packaging metadata the project never had: a top-level `homepage`, and a `linux.maintainer` (set to the GitHub noreply address rather than a personal one, since it is published inside every `.deb`).
- **Documentation screenshot harness** (`make shots`, `npm run shots`). Boots the real renderer against a fixture mixer defined in `tools/screenshot/fixtures.js` — a full 16-channel board with names, icons, colors, stereo links, DCA and mute-group membership, and a representative mapping set — then drives it through the scenes in `tools/screenshot/scenes.js` and writes `docs/images/*.png`. No mixer, MIDI interface, or network involved, so it reproduces on any platform. A `screenshots` job in CI runs it headlessly under `xvfb-run` on every push and attaches the images to the run, which doubles as a smoke test that the UI still renders.
- **README screenshots.** The README now shows the main window, a channel strip close-up, the mute-group bar, the mapping dialog, the mappings list, and the discovery and MIDI dialogs. The previous `docs/images/` set was captured at v1.2.0 and predated the v1.7.0 fader restyle and instrument icons; everything except the hand-annotated `main-window-annotated.png` is regenerated.

### Changed
- **jest 29 → 30, `@types/node` 20 → 26, and CI actions to v7.** The action bumps also clear the "Node.js 20 is deprecated" warning every workflow run was emitting. `typescript` 5.9 → 7.0 was deliberately **not** taken: 7.x is the native compiler and does not expose the JavaScript compiler API ts-jest needs, so adopting it means carrying two TypeScript packages side by side — a migration to plan rather than a dependency update, and one that buys users nothing.

### Fixed
- **Channel menu could open off the bottom of the window.** It was positioned while still showing "Reading channel…" and then grew several times taller once the switches arrived, so one opened near the bottom edge ran off-screen. It now re-anchors after the contents load.
- **A channel with no icon could not open its settings menu.** The menu opens from the instrument icon, and a channel the console reports no icon for rendered that icon with `visibility: hidden` — which preserves the layout but also swallows the click, leaving those channels with no way in. They now show a dimmed **⋮** in the same place, which opens the same menu. Found on a test rack's unnamed channel 16.
- **Channel labels truncated on Linux.** The default Linux sans is wider than the macOS system font, so fader name and mapping badges that fit on a Mac ("Snare Top", "Playback L", "CC21 Ch1") ellipsized there by 1-5px. `fitFaderLabels()` now steps the font size down one notch for the badges that actually overflow, on any platform — which also helps the long channel names a console can hand back. Labels that are genuinely too long still ellipsize rather than shrink into illegibility. Reads are batched ahead of the writes, so the common case of nothing overflowing costs a single layout pass.

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

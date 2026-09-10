/**
 * Fixture preload for the documentation screenshot harness.
 *
 * The renderer only ever talks to the main process through the `electronAPI`
 * bridge that src/main/preload.ts installs. That makes it swappable: this file
 * exposes the same surface backed by a synthetic mixer instead of a real one,
 * so `tools/screenshot/main.js` can drive the *real* renderer — the actual
 * dist/renderer/index.html users see — with a full, realistic channel set and
 * no hardware, no network, and no MIDI stack.
 *
 * Nothing here ships: electron-builder's `files` list only packages dist/**,
 * so tools/ never reaches a release.
 */

const { contextBridge } = require('electron');

/** Version comes from main.js via webPreferences.additionalArguments. */
const APP_VERSION =
  (process.argv.find((a) => a.startsWith('--shot-app-version=')) || '=').split('=')[1] || '0.0.0';

// ---------------------------------------------------------------------------
// The board: a 16-channel rock/worship setup, the kind of layout the docs are
// meant to illustrate. Icons are real StudioLive icon IDs (see SVG_ICONS in
// the renderer) so the instrument glyphs added in v1.7.0 actually render.
// ---------------------------------------------------------------------------
const LINE = [
  { name: 'Kick In',    icon: 'drums/kickin',         color: '#c0392b', level: 72, src: 1 },
  { name: 'Snare Top',  icon: 'drums/snaretop',       color: '#c0392b', level: 68, src: 2 },
  { name: 'Hi-Hat',     icon: 'drums/hihat',          color: '#c0392b', level: 54, src: 3 },
  { name: 'Rack Tom',   icon: 'drums/racktom',        color: '#c0392b', level: 57, src: 4 },
  // Stereo pairs live on odd/even boundaries, the way the console links them:
  // the flag sits on the odd channel and the renderer folds N and N+1 together.
  { name: 'OH L',       icon: 'drums/ohleft',         color: '#c0392b', level: 61, src: 5, link: true },
  { name: 'OH R',       icon: 'drums/ohright',        color: '#c0392b', level: 61, src: 6 },
  { name: 'Bass DI',    icon: 'guitars/bass',           color: '#8e6cc0', level: 70, src: 7 },
  { name: 'Acoustic',   icon: 'guitars/acoustic', color: '#3d8ec9', level: 58, src: 8 },
  { name: 'Gtr L',      icon: 'guitars/electric', color: '#3d8ec9', level: 64, src: 9, link: true },
  { name: 'Gtr R',      icon: 'guitars/electric', color: '#3d8ec9', level: 64, src: 10 },
  { name: 'Keys L',     icon: 'keyboards/piano',          color: '#d8a13a', level: 66, src: 11, link: true },
  { name: 'Keys R',     icon: 'keyboards/piano',          color: '#d8a13a', level: 66, src: 12 },
  { name: 'Lead Vox',   icon: 'vocals/leadvocals',     color: '#4a9b7f', level: 78, src: 13 },
  { name: 'BGV 1',      icon: 'vocals/backupvocals',   color: '#4a9b7f', level: 62, src: 14 },
  { name: 'Playback L', icon: 'other/computer',       color: '#7f8c8d', level: 55, src: 15, link: true },
  // Deliberately icon-less: a channel the console has no icon for must still
  // reach its settings menu. Matches ch16 "FOO" on the test rack.
  { name: 'Spare',      icon: null,                   color: '#7f8c8d', level: 55, src: 16 },
];

const SUB = [
  { name: 'Drums',   icon: 'drums/drumset',     color: '#c0392b', level: 74 },
  { name: 'Band',    icon: 'guitars/electric', color: '#3d8ec9', level: 70 },
  { name: 'Vocals',  icon: 'vocals/leadvocals',  color: '#4a9b7f', level: 76 },
  { name: 'Tracks',  icon: 'other/computer',    color: '#7f8c8d', level: 62 },
];

const DCA = [
  { name: 'Drums',  icon: 'drums/drumset',        color: '#c0392b', level: 75, members: [1, 2, 3, 4, 5, 6] },
  { name: 'Band',   icon: 'guitars/electric', color: '#3d8ec9', level: 71, members: [7, 8, 9, 10, 11, 12] },
  { name: 'Vocals', icon: 'vocals/leadvocals',     color: '#4a9b7f', level: 79, members: [13, 14] },
  { name: 'Tracks', icon: 'other/computer',       color: '#d8a13a', level: 60, members: [15, 16] },
];

const AUX = [
  { name: 'IEM Vox',  icon: 'other/iem',         color: '#4a9b7f', level: 65 },
  { name: 'IEM Gtr',  icon: 'other/iem',         color: '#3d8ec9', level: 63 },
  { name: 'Wedge 1',  icon: 'other/wedgemonitor', color: '#d8a13a', level: 58 },
  { name: 'Wedge 2',  icon: 'other/wedgemonitor', color: '#d8a13a', level: 58 },
  { name: 'Lobby',    icon: 'other/fohmain',     color: '#7f8c8d', level: 45 },
  { name: 'Stream',   icon: 'other/computer',    color: '#7f8c8d', level: 70 },
];

const FX = [
  { name: 'Vox Verb', icon: 'fx', color: '#8e6cc0', level: 55 },
  { name: 'Plate',    icon: 'fx', color: '#8e6cc0', level: 50 },
  { name: 'Delay',    icon: 'fx', color: '#8e6cc0', level: 44 },
  { name: 'Drum Rm',  icon: 'fx', color: '#8e6cc0', level: 38 },
];

const MAIN = [{ name: 'Main', icon: 'other/fohmain', color: '#4a9b7f', level: 80 }];

const BANKS = { line: LINE, sub: SUB, dca: DCA, aux: AUX, fxreturn: FX, fx: FX, main: MAIN };

const MUTE_GROUPS = [
  { name: 'All Mics',  members: [1, 2, 3, 4, 5, 6, 13, 14], muted: false },
  { name: 'Band',      members: [7, 8, 9, 10, 11, 12],      muted: false },
  { name: 'Tracks',    members: [15, 16],                   muted: true  },
  { name: 'Walk-In',   members: [15, 16],                   muted: false },
  { name: 'Mute Group 5', members: [], muted: false },
  { name: 'Mute Group 6', members: [], muted: false },
];

// Channels that are muted / soloed in the captured state — a couple of each so
// the docs show what the indicators actually look like.
const MUTED = new Set(['line:4', 'line:15', 'line:16']);
const SOLOED = new Set(['line:13']);

// Per-channel switch state for the channel menu. A vocal channel with phantom
// on and its dynamics engaged is the representative case for the docs shot.
const SWITCHES = {
  'line:13': { phantom: true, polarity: false, mono: false, gate: true, compressor: true, eq: true, limiter: false },
  'line:1': { phantom: false, polarity: false, mono: false, gate: true, compressor: true, eq: true, limiter: false },
};

// Preamp gain in dB, matching what a working board looks like.
const GAINS = { 'line:1': 24, 'line:6': 18, 'line:13': 32, 'line:14': 30 };

// A slice of the console's factory channel-preset library, in the same
// `NN.Title.Category.channel` shape the console reports, so the match-hint
// ordering can be seen in the docs shot.
const CHANNEL_PRESETS = [
  { name: '18.Male 1.Vocal.channel', title: 'Male 1', category: 'Vocal' },
  { name: '19.Female 1.Vocal.channel', title: 'Female 1', category: 'Vocal' },
  { name: '20.Vocal Bright.Vocal.channel', title: 'Vocal Bright', category: 'Vocal' },
  { name: '01.Kick 1.Drum.channel', title: 'Kick 1', category: 'Drum' },
  { name: '07.Snare 1.Drum.channel', title: 'Snare 1', category: 'Drum' },
  { name: '31.Electric Bass 1.Guit.channel', title: 'Electric Bass 1', category: 'Guit' },
  { name: '38.Piano Bright.Keys.channel', title: 'Piano Bright', category: 'Keys' },
  { name: '44.Congas.Perc.channel', title: 'Congas', category: 'Perc' },
];

const MIDI_DEVICES = ['Logic Pro Virtual Out', 'Launchkey 49 MK3', 'X-Touch Mini'];
const CONNECTED_MIDI = ['Logic Pro Virtual Out', 'X-Touch Mini'];

const MIDI_DEVICE_COLORS = {
  'Logic Pro Virtual Out': '#5b9bd5',
  'X-Touch Mini': '#d97c4e',
};

const DCA_COLORS = { 1: '#c0392b', 2: '#3d8ec9', 3: '#4a9b7f', 4: '#d8a13a' };

/** A representative mapping set: DAW faders on the DCAs plus vocal channels. */
const MAPPINGS = [
  { midi: { type: 'cc', channel: 1, controller: 7,  device: 'Logic Pro Virtual Out' }, mixer: { action: 'volume', channel: { type: 'DCA', channel: 1 } } },
  { midi: { type: 'cc', channel: 2, controller: 7,  device: 'Logic Pro Virtual Out' }, mixer: { action: 'volume', channel: { type: 'DCA', channel: 2 } } },
  { midi: { type: 'cc', channel: 3, controller: 7,  device: 'Logic Pro Virtual Out' }, mixer: { action: 'volume', channel: { type: 'DCA', channel: 3 } } },
  { midi: { type: 'cc', channel: 4, controller: 7,  device: 'Logic Pro Virtual Out' }, mixer: { action: 'volume', channel: { type: 'DCA', channel: 4 } } },
  { midi: { type: 'cc', channel: 1, controller: 21, device: 'X-Touch Mini' },          mixer: { action: 'volume', channel: { type: 'LINE', channel: 13 } } },
  { midi: { type: 'cc', channel: 1, controller: 22, device: 'X-Touch Mini' },          mixer: { action: 'volume', channel: { type: 'LINE', channel: 14 } } },
  { midi: { type: 'note-toggle', channel: 1, note: 60, device: 'X-Touch Mini' },       mixer: { action: 'mute',   channel: { type: 'LINE', channel: 13 } } },
  { midi: { type: 'note-toggle', channel: 1, note: 62, device: 'X-Touch Mini' },       mixer: { action: 'mutegroup', channel: { channel: 3 } } },
];

const MIXER = {
  connected: true,
  ip: '192.168.1.50',
  model: 'StudioLive 32SC',
  deviceName: 'FOH Console',
  serial: 'SL32SC-0007421',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const bank = (type) => BANKS[String(type || 'line').toLowerCase()] || [];
const entry = (type, ch) => bank(type)[ch - 1];
const key = (type, ch) => `${String(type).toLowerCase()}:${ch}`;

/** Per-channel volume, mutated by set-mixer-volume so drag scenes look right. */
const levels = {};
for (const [type, list] of Object.entries(BANKS)) {
  list.forEach((c, i) => { levels[key(type, i + 1)] = c.level; });
}

const list = (type, count, build) => {
  const out = [];
  for (let i = 1; i <= count; i++) out.push(build(i, entry(type, i)));
  return out;
};

// ---------------------------------------------------------------------------
// The fixture-backed IPC surface. Channel names match src/main/preload.ts.
// ---------------------------------------------------------------------------
const HANDLERS = {
  // --- status -------------------------------------------------------------
  'get-app-version': () => APP_VERSION,
  'get-app-info': () => ({
    name: 'StudioLive MIDI Controller',
    version: APP_VERSION,
    description: 'MIDI controller for PreSonus StudioLive mixers using Logic Pro',
    author: 'sandinak',
    license: 'MIT',
    homepage: 'https://github.com/sandinak/studiolive-midi-controller',
    electron: '44.0.0',
    node: '24.18.1',
    chrome: '152.0.7977.54',
    platform: 'darwin arm64',
    apiLibrary: 'git+https://github.com/sandinak/presonus-studiolive-api.git#v1.10.0',
  }),
  'get-mixer-status': () => ({
    ...MIXER,
    name: MIXER.deviceName,
    preferredIp: MIXER.ip,
    preferredModel: MIXER.model,
    preferredDeviceName: MIXER.deviceName,
    preferredSerial: MIXER.serial,
  }),
  'get-midi-status': () => ({
    connected: true,
    device: CONNECTED_MIDI[0],
    devices: CONNECTED_MIDI,
    preferredDevices: CONNECTED_MIDI,
  }),
  'get-midi-devices': () => ({
    inputs: MIDI_DEVICES,
    outputs: MIDI_DEVICES,
    connected: CONNECTED_MIDI,
  }),
  'get-connected-midi-devices': () => CONNECTED_MIDI,
  'get-midi-device-colors': () => MIDI_DEVICE_COLORS,
  'get-tuio-port': () => 3333,

  // --- discovery ----------------------------------------------------------
  'get-discovered-mixers': () => [
    { ip: MIXER.ip, model: MIXER.model, name: MIXER.deviceName, deviceName: MIXER.deviceName, serial: MIXER.serial },
    { ip: '192.168.1.51', model: 'StudioLive 16R', name: 'Stage Rack', deviceName: 'Stage Rack', serial: 'SL16R-0003118' },
  ],
  'discover-mixers': () => HANDLERS['get-discovered-mixers'](),
  'get-preferred-mixer-ip': () => MIXER.ip,
  'probe-mixer-ip': (ip) => ({ reachable: ip === MIXER.ip }),
  'identify-mixer-ip': () => ({ ...MIXER, name: MIXER.deviceName }),
  'check-mixer-match': () => ({ match: true }),
  'connect-mixer': () => ({ success: true, ...MIXER }),

  // --- channel data -------------------------------------------------------
  'get-channel-counts': () => ({ LINE: 16, AUX: 6, FX: 4, FXRETURN: 4, SUB: 4, DCA: 4, MAIN: 1 }),
  'get-channel-names': (type = 'line', count = 16) =>
    list(type, count, (i, c) => ({ channel: i, name: c ? c.name : `Ch ${i}` })),
  'get-channel-colors': (type = 'line', count = 16) =>
    list(type, count, (i, c) => ({ channel: i, color: c ? c.color : null })),
  'get-channel-icons': (type = 'line', count = 16) =>
    list(type, count, (i, c) => ({ channel: i, icon: c ? c.icon : null })),
  'get-channel-input-sources': (type = 'line', count = 16) =>
    list(type, count, (i, c) => ({ channel: i, inputsrc: c && c.src ? c.src : null })),
  'get-channel-link': (type, ch) =>
    String(type).toUpperCase() === 'LINE' ? Boolean(entry(type, ch) && entry(type, ch).link) : false,
  'get-mixer-level': (type, ch) => levels[key(type, ch)] ?? null,
  'get-channel-mute': (type, ch) => MUTED.has(key(type, ch)),
  'get-channel-solo': (type, ch) => SOLOED.has(key(type, ch)),
  'get-channel-main-assign': () => true,
  'set-channel-main-assign': () => ({ success: true }),
  'set-channel-input-source': () => ({ success: true }),

  // --- per-channel switches ------------------------------------------------
  'get-channel-switches': (type, ch) => {
    const c = entry(type, ch);
    if (!c) return null;
    const k = key(type, ch);
    return {
      phantom: SWITCHES[k]?.phantom ?? false,
      polarity: SWITCHES[k]?.polarity ?? false,
      mono: SWITCHES[k]?.mono ?? false,
      gate: SWITCHES[k]?.gate ?? false,
      compressor: SWITCHES[k]?.compressor ?? false,
      eq: SWITCHES[k]?.eq ?? false,
      limiter: SWITCHES[k]?.limiter ?? false,
    };
  },
  'set-channel-switch': (type, ch, name, state) => {
    const k = key(type, ch);
    SWITCHES[k] = { ...(SWITCHES[k] || {}), [name]: Boolean(state) };
    return { success: true, state: Boolean(state) };
  },
  'set-app-mode': () => ({ success: true }),

  // --- preamp gain and console presets -------------------------------------
  'get-preamp-gain': (type, ch) => {
    const c = entry(type, ch);
    if (!c) return null;
    return { gain: GAINS[key(type, ch)] ?? 0, range: { min: 0, max: 60 } };
  },
  'set-preamp-gain': (type, ch, db) => {
    GAINS[key(type, ch)] = Number(db);
    return { success: true, gain: Number(db) };
  },
  'get-channel-presets': () => CHANNEL_PRESETS,
  'recall-channel-preset': () => ({ success: true }),

  // --- groups -------------------------------------------------------------
  'get-dca-group-assignments': (dca) => (DCA[dca - 1] ? DCA[dca - 1].members : []),
  'get-dca-colors': () => DCA_COLORS,
  'get-autofilter-group-assignments': (n) => (DCA[n - 1] ? DCA[n - 1].members : []),
  'get-autofilter-group-names': (count = 8) =>
    list('dca', count, (i, c) => ({ channel: i, name: c ? c.name : `Group ${i}` })),
  'get-mute-group-names': () => MUTE_GROUPS.map((g, i) => ({ group: i + 1, name: g.name })),
  'get-mute-group-state': (n) => Boolean(MUTE_GROUPS[n - 1] && MUTE_GROUPS[n - 1].muted),
  'get-mute-group-assignments': (n) => (MUTE_GROUPS[n - 1] ? MUTE_GROUPS[n - 1].members : []),

  // --- mappings / presets -------------------------------------------------
  'get-mappings': () => MAPPINGS,
  'get-current-preset': () => ({ name: 'Sunday AM — FOH', version: '1.0', mappings: MAPPINGS }),
  'get-current-preset-path': () => '/Users/you/Documents/StudioLive Presets/sunday-am-foh.json',
  'add-mapping': () => ({ success: true }),
  'update-mapping': () => ({ success: true }),
  'remove-mapping': () => ({ success: true }),
  'save-preset': () => ({ success: true }),
  'save-preset-to-path': () => ({ success: true }),

  // --- view preferences ---------------------------------------------------
  'get-fader-filter': () => 'all',
  'get-level-visibility': () => 'meter',
  'get-fader-stacking': () => false,

  // --- actions (no-ops that keep the UI responsive) -----------------------
  'set-mixer-volume': (type, ch, value) => { levels[key(type, ch)] = value; return { success: true }; },
  'toggle-mute': (type, ch) => {
    const k = key(type, ch);
    MUTED.has(k) ? MUTED.delete(k) : MUTED.add(k);
    return { success: true, muted: MUTED.has(k) };
  },
  'toggle-solo': (type, ch) => {
    const k = key(type, ch);
    SOLOED.has(k) ? SOLOED.delete(k) : SOLOED.add(k);
    return { success: true, soloed: SOLOED.has(k) };
  },
  'toggle-mute-group': (n) => {
    if (MUTE_GROUPS[n - 1]) MUTE_GROUPS[n - 1].muted = !MUTE_GROUPS[n - 1].muted;
    return { success: true };
  },
  'check-for-updates': () => ({ updateAvailable: false, currentVersion: APP_VERSION }),
  'get-changelog': () => ({ success: true, content: '# Changelog\n\nSee CHANGELOG.md' }),
};

/** Anything not listed above resolves to a benign default. */
const DEFAULTS = {
  connect: { success: true },
  disconnect: { success: true },
  set: { success: true },
  start: { success: true },
  stop: { success: true },
  send: { success: true },
  open: { success: true },
  load: null,
  create: { success: true },
};

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: async (channel, ...args) => {
    const handler = HANDLERS[channel];
    if (handler) return handler(...args);
    const verb = channel.split('-')[0];
    if (verb in DEFAULTS) return DEFAULTS[verb];
    // get-* with no fixture: an empty list is what the real handlers return
    // when the mixer has nothing to say.
    return channel.startsWith('get-') ? [] : { success: true };
  },
  // Push events are driven by the harness (see main.js emit()), not by a
  // real mixer — scenes opt in to metering when they want it.
  on: (channel, listener) => {
    (window.__shotListeners ||= {})[channel] ||= [];
    window.__shotListeners[channel].push(listener);
    return () => {
      const l = window.__shotListeners[channel];
      const i = l.indexOf(listener);
      if (i >= 0) l.splice(i, 1);
    };
  },
  openExternal: async () => {},
});

// Let scenes push mixer events into the renderer from the main process.
contextBridge.exposeInMainWorld('__shotEmit', (channel, ...args) => {
  for (const l of (window.__shotListeners || {})[channel] || []) l(...args);
});

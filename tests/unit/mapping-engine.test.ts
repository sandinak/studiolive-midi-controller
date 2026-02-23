import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MappingEngine } from '../../src/main/mapping-engine';
import type { MidiMapping } from '../../src/shared/types';

// Helper to build a minimal CC→volume mapping
function makeVolumeMapping(device = '', channel = 1, controller = 7, chType = 'LINE', chNum = 1): MidiMapping {
  return {
    midi: { type: 'cc', channel, controller, device: device || undefined },
    mixer: {
      action: 'volume',
      channel: { type: chType, channel: chNum } as any,
      range: [0, 100],
    },
  };
}

function makeMuteMapping(channel = 1, note = 60): MidiMapping {
  return {
    midi: { type: 'note', channel, note },
    mixer: { action: 'mute', channel: { type: 'LINE', channel: 1 } as any },
  };
}

function writeTempPreset(obj: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'));
  const file = path.join(dir, 'preset.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

describe('MappingEngine', () => {
  let engine: MappingEngine;

  beforeEach(() => {
    engine = new MappingEngine();
  });

  // ---- Preset loading ----
  describe('loadPreset', () => {
    it('loads a valid preset', () => {
      const m = makeVolumeMapping();
      const file = writeTempPreset({ name: 'Test', version: '1.0', mappings: [m] });
      engine.loadPreset(file);
      expect(engine.getCurrentPreset()).toBe('Test');
      expect(engine.getMappings()).toHaveLength(1);
    });

    it('throws on a file that is too large', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'));
      const file = path.join(dir, 'big.json');
      // Write a file larger than 5 MB
      const huge = Buffer.alloc(5_242_881, 'x');
      fs.writeFileSync(file, huge);
      expect(() => engine.loadPreset(file)).toThrow('too large');
    });

    it('throws when mappings is not an array', () => {
      const file = writeTempPreset({ name: 'Bad', version: '1.0', mappings: 'oops' });
      expect(() => engine.loadPreset(file)).toThrow('array');
    });

    it('throws when name is missing', () => {
      const file = writeTempPreset({ version: '1.0', mappings: [] });
      expect(() => engine.loadPreset(file)).toThrow('name');
    });

    it('reads mixerIp and midiDevices from preset', () => {
      const file = writeTempPreset({
        name: 'P', version: '1.0', mappings: [],
        mixerIp: '10.0.0.5',
        midiDevices: ['Korg nanoKONTROL2'],
      });
      engine.loadPreset(file);
      expect(engine.getPreferredMixerIp()).toBe('10.0.0.5');
      expect(engine.getPreferredMidiDevices()).toEqual(['Korg nanoKONTROL2']);
    });

    it('falls back to legacy midiDevice field', () => {
      const file = writeTempPreset({
        name: 'P', version: '1.0', mappings: [],
        midiDevice: 'Old Device',
      });
      engine.loadPreset(file);
      expect(engine.getPreferredMidiDevices()).toEqual(['Old Device']);
    });
  });

  // ---- getMappings direct reference ----
  it('getMappings() returns the same array reference (no copy)', () => {
    const m = makeVolumeMapping();
    engine.addMapping(m);
    const ref1 = engine.getMappings();
    const ref2 = engine.getMappings();
    expect(ref1).toBe(ref2);
  });

  // ---- CRUD ----
  describe('addMapping / removeMapping / updateMapping / clearMappings', () => {
    it('addMapping appends a mapping', () => {
      engine.addMapping(makeVolumeMapping());
      expect(engine.getMappings()).toHaveLength(1);
    });

    it('removeMapping removes by index', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7));
      engine.addMapping(makeVolumeMapping('', 1, 8));
      engine.removeMapping(0);
      expect(engine.getMappings()).toHaveLength(1);
      expect((engine.getMappings()[0].midi as any).controller).toBe(8);
    });

    it('updateMapping replaces at index', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7));
      const updated = makeVolumeMapping('', 1, 99);
      engine.updateMapping(0, updated);
      expect((engine.getMappings()[0].midi as any).controller).toBe(99);
    });

    it('clearMappings empties the list', () => {
      engine.addMapping(makeVolumeMapping());
      engine.clearMappings();
      expect(engine.getMappings()).toHaveLength(0);
    });
  });

  // ---- translateMidiToMixer — CC ----
  describe('translateMidiToMixer CC', () => {
    it('translates a CC message to a volume command', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7, 'LINE', 1));
      const cmd = engine.translateMidiToMixer({ type: 'cc', channel: 1, controller: 7, value: 127 });
      expect(cmd).not.toBeNull();
      expect(cmd!.action).toBe('volume');
      expect(cmd!.value).toBeCloseTo(100);
    });

    it('scales CC value 0 to 0%', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7));
      const cmd = engine.translateMidiToMixer({ type: 'cc', channel: 1, controller: 7, value: 0 });
      expect(cmd!.value).toBeCloseTo(0);
    });

    it('scales CC value 64 to ~50%', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7));
      const cmd = engine.translateMidiToMixer({ type: 'cc', channel: 1, controller: 7, value: 64 });
      expect(cmd!.value).toBeCloseTo(50.4, 0); // 64/127 * 100
    });

    it('returns null for unregistered CC', () => {
      const cmd = engine.translateMidiToMixer({ type: 'cc', channel: 1, controller: 9, value: 64 });
      expect(cmd).toBeNull();
    });

    it('prefers device-specific mapping over global', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7, 'LINE', 1));    // global
      engine.addMapping(makeVolumeMapping('Device A', 1, 7, 'LINE', 2)); // device-specific
      const cmd = engine.translateMidiToMixer({ type: 'cc', channel: 1, controller: 7, value: 127, device: 'Device A' });
      expect((cmd!.channel as any).channel).toBe(2);
    });

    it('falls back to global mapping when device does not match a specific one', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7, 'LINE', 1)); // global
      const cmd = engine.translateMidiToMixer({ type: 'cc', channel: 1, controller: 7, value: 127, device: 'Other' });
      expect((cmd!.channel as any).channel).toBe(1);
    });
  });

  // ---- translateMidiToMixer — Note ----
  describe('translateMidiToMixer Note', () => {
    it('translates note_on to a mute toggle command', () => {
      engine.addMapping(makeMuteMapping(1, 60));
      const cmd = engine.translateMidiToMixer({ type: 'note_on', channel: 1, note: 60, value: 100 });
      expect(cmd).not.toBeNull();
      expect(cmd!.action).toBe('mute');
      expect(cmd!.toggle).toBe(true);  // note_on → activate
    });

    it('translates note_off to mute toggle false', () => {
      engine.addMapping(makeMuteMapping(1, 60));
      const cmd = engine.translateMidiToMixer({ type: 'note_off', channel: 1, note: 60, value: 0 });
      expect(cmd!.toggle).toBe(false);
    });

    it('returns null for unregistered note', () => {
      const cmd = engine.translateMidiToMixer({ type: 'note_on', channel: 1, note: 99, value: 100 });
      expect(cmd).toBeNull();
    });
  });

  // ---- mute invert flag ----
  it('applies invert flag to mute mapping', () => {
    const m: MidiMapping = {
      midi: { type: 'note', channel: 1, note: 60, invert: true },
      mixer: { action: 'mute', channel: { type: 'LINE', channel: 1 } as any },
    };
    engine.addMapping(m);
    const cmd = engine.translateMidiToMixer({ type: 'note_on', channel: 1, note: 60, value: 100 });
    expect(cmd!.toggle).toBe(false); // inverted: note_on → false
  });

  // ---- note-value range ----
  describe('note-value range mapping', () => {
    it('maps a note within the range to a scaled volume', () => {
      const m: MidiMapping = {
        midi: { type: 'note-value', channel: 1, noteMin: 24, noteMax: 120 } as any,
        mixer: { action: 'volume', channel: { type: 'LINE', channel: 1 } as any, range: [0, 100] },
      };
      engine.addMapping(m);
      // note 24 should map to 0%, note 120 to 100%
      const cmdLow = engine.translateMidiToMixer({ type: 'note_on', channel: 1, note: 24, value: 100 });
      const cmdHigh = engine.translateMidiToMixer({ type: 'note_on', channel: 1, note: 120, value: 100 });
      expect(cmdLow!.value).toBeCloseTo(0);
      expect(cmdHigh!.value).toBeCloseTo(100);
    });
  });

  // ---- findVolumeMapping ----
  describe('findVolumeMapping', () => {
    it('finds the mapping for a known channel', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7, 'LINE', 3));
      const found = engine.findVolumeMapping('LINE', 3);
      expect(found).toBeDefined();
      expect((found!.midi as any).controller).toBe(7);
    });

    it('returns undefined for an unmapped channel', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7, 'LINE', 3));
      expect(engine.findVolumeMapping('LINE', 9)).toBeUndefined();
    });

    it('is case-insensitive on channel type', () => {
      engine.addMapping(makeVolumeMapping('', 1, 7, 'LINE', 2));
      expect(engine.findVolumeMapping('line', 2)).toBeDefined();
    });
  });

  // ---- Preferred IP / MIDI devices ----
  describe('preferred IP and MIDI device management', () => {
    it('sets and gets preferred mixer IP', () => {
      engine.setPreferredMixerIp('10.0.0.1');
      expect(engine.getPreferredMixerIp()).toBe('10.0.0.1');
    });

    it('adds and removes preferred MIDI devices', () => {
      engine.addPreferredMidiDevice('Device A');
      engine.addPreferredMidiDevice('Device B');
      expect(engine.getPreferredMidiDevices()).toEqual(['Device A', 'Device B']);
      engine.removePreferredMidiDevice('Device A');
      expect(engine.getPreferredMidiDevices()).toEqual(['Device B']);
    });

    it('does not add duplicate MIDI devices', () => {
      engine.addPreferredMidiDevice('Device A');
      engine.addPreferredMidiDevice('Device A');
      expect(engine.getPreferredMidiDevices()).toHaveLength(1);
    });
  });

  // ---- MIDI feedback ----
  describe('MIDI feedback enabled', () => {
    it('is enabled by default', () => {
      expect(engine.getMidiFeedbackEnabled()).toBe(true);
    });

    it('can be disabled', () => {
      engine.setMidiFeedbackEnabled(false);
      expect(engine.getMidiFeedbackEnabled()).toBe(false);
    });

    it('can be re-enabled after being disabled', () => {
      engine.setMidiFeedbackEnabled(false);
      engine.setMidiFeedbackEnabled(true);
      expect(engine.getMidiFeedbackEnabled()).toBe(true);
    });
  });

  // ---- MIDI device colors ----
  describe('MIDI device colors', () => {
    it('returns empty object by default', () => {
      expect(engine.getMidiDeviceColors()).toEqual({});
    });

    it('sets and gets a color for a device', () => {
      engine.setMidiDeviceColor('Korg nanoKONTROL2', '#ff0000');
      expect(engine.getMidiDeviceColors()).toEqual({ 'Korg nanoKONTROL2': '#ff0000' });
    });

    it('returns a shallow copy (external mutation does not affect engine state)', () => {
      engine.setMidiDeviceColor('Device A', '#00ff00');
      const colors = engine.getMidiDeviceColors();
      colors['Device A'] = '#000000';
      expect(engine.getMidiDeviceColors()['Device A']).toBe('#00ff00');
    });

    it('removes a color entry when set to empty string', () => {
      engine.setMidiDeviceColor('Device A', '#ff0000');
      engine.setMidiDeviceColor('Device A', '');
      expect(engine.getMidiDeviceColors()).not.toHaveProperty('Device A');
    });

    it('can store colors for multiple devices', () => {
      engine.setMidiDeviceColor('Device A', '#ff0000');
      engine.setMidiDeviceColor('Device B', '#0000ff');
      const colors = engine.getMidiDeviceColors();
      expect(colors['Device A']).toBe('#ff0000');
      expect(colors['Device B']).toBe('#0000ff');
    });
  });

  // ---- Level visibility ----
  describe('level visibility', () => {
    it('defaults to "none"', () => {
      expect(engine.getLevelVisibility()).toBe('none');
    });

    it('can be set to "indicator"', () => {
      engine.setLevelVisibility('indicator');
      expect(engine.getLevelVisibility()).toBe('indicator');
    });

    it('can be set to "meter"', () => {
      engine.setLevelVisibility('meter');
      expect(engine.getLevelVisibility()).toBe('meter');
    });

    it('can be reset back to "none"', () => {
      engine.setLevelVisibility('meter');
      engine.setLevelVisibility('none');
      expect(engine.getLevelVisibility()).toBe('none');
    });
  });

  // ---- Peak hold ----
  describe('peak hold', () => {
    it('defaults to false', () => {
      expect(engine.getPeakHold()).toBe(false);
    });

    it('can be enabled', () => {
      engine.setPeakHold(true);
      expect(engine.getPeakHold()).toBe(true);
    });

    it('can be disabled after being enabled', () => {
      engine.setPeakHold(true);
      engine.setPeakHold(false);
      expect(engine.getPeakHold()).toBe(false);
    });
  });

  // ---- Fader filter ----
  describe('fader filter', () => {
    it('defaults to "all"', () => {
      expect(engine.getFaderFilter()).toBe('all');
    });

    it('can be set to "mapped"', () => {
      engine.setFaderFilter('mapped');
      expect(engine.getFaderFilter()).toBe('mapped');
    });

    it('can be set to "added"', () => {
      engine.setFaderFilter('added');
      expect(engine.getFaderFilter()).toBe('added');
    });

    it('can be reset to "all"', () => {
      engine.setFaderFilter('mapped');
      engine.setFaderFilter('all');
      expect(engine.getFaderFilter()).toBe('all');
    });
  });

  // ---- Settings persistence via preset save/load ----
  describe('settings round-trip via preset save/load', () => {
    it('persists midiDeviceColors, levelVisibility, peakHold, midiFeedbackEnabled across save/load', () => {
      engine.setMidiDeviceColor('Korg', '#abcdef');
      engine.setLevelVisibility('meter');
      engine.setPeakHold(true);
      engine.setMidiFeedbackEnabled(false);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'));
      const file = path.join(dir, 'settings-test.json');
      engine.savePreset(file, 'Settings Test');

      const engine2 = new MappingEngine();
      engine2.loadPreset(file);
      expect(engine2.getMidiDeviceColors()).toEqual({ 'Korg': '#abcdef' });
      expect(engine2.getLevelVisibility()).toBe('meter');
      expect(engine2.getPeakHold()).toBe(true);
      expect(engine2.getMidiFeedbackEnabled()).toBe(false);
    });

    it('defaults midiFeedbackEnabled to true when not present in preset', () => {
      const file = writeTempPreset({ name: 'P', version: '1.0', mappings: [] });
      engine.loadPreset(file);
      expect(engine.getMidiFeedbackEnabled()).toBe(true);
    });

    it('defaults levelVisibility to "none" when not present in preset', () => {
      const file = writeTempPreset({ name: 'P', version: '1.0', mappings: [] });
      engine.loadPreset(file);
      expect(engine.getLevelVisibility()).toBe('none');
    });
  });
});

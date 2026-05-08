/**
 * Tests for MappingEngine.checkMixerMatch() — verifies that preset
 * mixer identity matching works correctly for mismatch detection.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MappingEngine } from '../../src/main/mapping-engine';

function writeTempPreset(obj: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'));
  const file = path.join(dir, 'preset.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

describe('checkMixerMatch', () => {
  let engine: MappingEngine;

  beforeEach(() => {
    engine = new MappingEngine();
  });

  // ---- No mixer stored (first use) ----
  it('returns null when no mixer is stored in preset', () => {
    expect(engine.checkMixerMatch('SERIAL-1', 'StudioLive 32R', '10.0.0.1')).toBeNull();
  });

  it('returns null after loading preset without mixer info', () => {
    const file = writeTempPreset({ name: 'Empty', version: '1.0', mappings: [] });
    engine.loadPreset(file);
    expect(engine.checkMixerMatch('SERIAL-1', 'StudioLive 32R', '10.0.0.1')).toBeNull();
  });

  // ---- Serial-based matching ----
  it('matches when serial numbers are identical', () => {
    const file = writeTempPreset({
      name: 'Test', version: '1.0', mappings: [],
      mixerIp: '10.0.0.1', mixerSerial: 'ABC123', mixerModel: 'StudioLive 32R',
    });
    engine.loadPreset(file);
    const result = engine.checkMixerMatch('ABC123', 'StudioLive 32R', '10.0.0.2');
    expect(result).not.toBeNull();
    expect(result!.match).toBe(true);
  });

  it('does not match when serial numbers differ', () => {
    const file = writeTempPreset({
      name: 'Test', version: '1.0', mappings: [],
      mixerIp: '10.0.0.1', mixerSerial: 'ABC123', mixerModel: 'StudioLive 32R',
    });
    engine.loadPreset(file);
    const result = engine.checkMixerMatch('XYZ789', 'StudioLive 32R', '10.0.0.1');
    expect(result!.match).toBe(false);
  });

  it('includes preset mixer info in the result', () => {
    const file = writeTempPreset({
      name: 'Test', version: '1.0', mappings: [],
      mixerIp: '10.0.0.5', mixerSerial: 'SER-1', mixerModel: 'StudioLive 16R',
      mixerDeviceName: 'FOH Rack',
    });
    engine.loadPreset(file);
    const result = engine.checkMixerMatch('SER-2', 'StudioLive 32R', '10.0.0.6');
    expect(result!.presetMixer).toEqual({
      serial: 'SER-1',
      model: 'StudioLive 16R',
      ip: '10.0.0.5',
      deviceName: 'FOH Rack',
    });
  });

  // ---- Model-based fallback (no serial on one side) ----
  it('does not match when models differ and no serial on connecting mixer', () => {
    const file = writeTempPreset({
      name: 'Test', version: '1.0', mappings: [],
      mixerIp: '10.0.0.1', mixerModel: 'StudioLive 32R',
    });
    engine.loadPreset(file);
    const result = engine.checkMixerMatch(null, 'StudioLive 16R', '10.0.0.1');
    expect(result!.match).toBe(false);
  });

  // ---- IP-based fallback ----
  it('matches when same IP and same model (no serials)', () => {
    const file = writeTempPreset({
      name: 'Test', version: '1.0', mappings: [],
      mixerIp: '10.0.0.1', mixerModel: 'StudioLive 32R',
    });
    engine.loadPreset(file);
    const result = engine.checkMixerMatch(null, 'StudioLive 32R', '10.0.0.1');
    expect(result!.match).toBe(true);
  });

  it('does not match when same model but different IP (no serials)', () => {
    const file = writeTempPreset({
      name: 'Test', version: '1.0', mappings: [],
      mixerIp: '10.0.0.1', mixerModel: 'StudioLive 32R',
    });
    engine.loadPreset(file);
    const result = engine.checkMixerMatch(null, 'StudioLive 32R', '10.0.0.2');
    expect(result!.match).toBe(false);
  });

  // ---- After setPreferredMixerInfo ----
  it('matches updated mixer info after setPreferredMixerInfo', () => {
    const file = writeTempPreset({ name: 'Test', version: '1.0', mappings: [] });
    engine.loadPreset(file);
    engine.setPreferredMixerInfo('10.0.0.5', 'StudioLive 32R', 'Main', 'NEW-SERIAL');
    const result = engine.checkMixerMatch('NEW-SERIAL', 'StudioLive 32R', '10.0.0.5');
    expect(result!.match).toBe(true);
  });

  it('does not match old serial after setPreferredMixerInfo updates it', () => {
    const file = writeTempPreset({
      name: 'Test', version: '1.0', mappings: [],
      mixerSerial: 'OLD-SERIAL', mixerIp: '10.0.0.1',
    });
    engine.loadPreset(file);
    engine.setPreferredMixerInfo('10.0.0.5', 'StudioLive 32R', 'Main', 'NEW-SERIAL');
    const result = engine.checkMixerMatch('OLD-SERIAL', 'StudioLive 32R', '10.0.0.1');
    expect(result!.match).toBe(false);
  });
});

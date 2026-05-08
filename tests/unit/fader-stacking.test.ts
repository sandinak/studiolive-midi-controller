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

describe('Fader Stacking', () => {
  let engine: MappingEngine;

  beforeEach(() => {
    engine = new MappingEngine();
  });

  // ---- Default state ----
  it('defaults to stacking disabled', () => {
    expect(engine.getFaderStacking()).toBe(false);
  });

  // ---- Setter / Getter ----
  it('setFaderStacking enables stacking', () => {
    engine.setFaderStacking(true);
    expect(engine.getFaderStacking()).toBe(true);
  });

  it('setFaderStacking disables stacking', () => {
    engine.setFaderStacking(true);
    engine.setFaderStacking(false);
    expect(engine.getFaderStacking()).toBe(false);
  });

  // ---- Preset loading ----
  it('loads faderStacking from preset', () => {
    const file = writeTempPreset({
      name: 'Stacked', version: '1.0', mappings: [],
      faderStacking: true,
    });
    engine.loadPreset(file);
    expect(engine.getFaderStacking()).toBe(true);
  });

  it('defaults faderStacking to false when not in preset', () => {
    const file = writeTempPreset({
      name: 'NoStack', version: '1.0', mappings: [],
    });
    engine.loadPreset(file);
    expect(engine.getFaderStacking()).toBe(false);
  });

  // ---- Preset saving ----
  it('saves faderStacking to preset file', () => {
    engine.setFaderStacking(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'));
    const file = path.join(dir, 'save-test.json');
    engine.savePreset(file, 'SaveTest');

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(saved.faderStacking).toBe(true);
  });

  it('omits faderStacking from preset when false', () => {
    engine.setFaderStacking(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'));
    const file = path.join(dir, 'save-test.json');
    engine.savePreset(file, 'SaveTest');

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(saved.faderStacking).toBeUndefined();
  });

  // ---- Auto-save ----
  it('auto-saves when stacking is toggled', () => {
    // Load a preset first so auto-save has a path
    const file = writeTempPreset({
      name: 'AutoSave', version: '1.0', mappings: [],
    });
    engine.loadPreset(file);

    engine.setFaderStacking(true);

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(saved.faderStacking).toBe(true);
  });

  // ---- Roundtrip ----
  it('roundtrips faderStacking through save/load', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'));
    const file = path.join(dir, 'roundtrip.json');

    engine.setFaderStacking(true);
    engine.savePreset(file, 'Roundtrip');

    const engine2 = new MappingEngine();
    engine2.loadPreset(file);
    expect(engine2.getFaderStacking()).toBe(true);
  });
});

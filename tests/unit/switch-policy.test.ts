/**
 * The Run-mode interlock decides whether a channel control may be written, and
 * it has to give the same answer to a click in the UI and to a MIDI message
 * from a controller. These pin that equivalence, and the refusals themselves —
 * which exist because phantom power can damage a ribbon microphone and a
 * mis-set gain can cause feedback.
 */

import {
  decideSwitchWrite,
  decideGainWrite,
  decidePresetRecall,
  asAppMode,
} from '../../src/main/switch-policy';

describe('decideSwitchWrite', () => {
  it('allows any switch in Edit mode', () => {
    for (const name of ['phantom', 'polarity', 'mono', 'gate', 'compressor', 'eq', 'limiter']) {
      const d = decideSwitchWrite('edit', name);
      expect(d.allowed).toBe(true);
      if (d.allowed) expect(d.switchName).toBe(name);
    }
  });

  it('refuses phantom power and polarity in Run mode', () => {
    for (const name of ['phantom', 'polarity']) {
      const d = decideSwitchWrite('run', name);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.error).toMatch(/Run mode/);
    }
  });

  // Dropping a gate or bypassing a compressor mid-set is normal and instantly
  // reversible, so those stay available while the interface is locked.
  it('still allows the processor switches in Run mode', () => {
    for (const name of ['mono', 'gate', 'compressor', 'eq', 'limiter']) {
      expect(decideSwitchWrite('run', name).allowed).toBe(true);
    }
  });

  it('refuses an unknown switch name in either mode', () => {
    for (const mode of ['edit', 'run'] as const) {
      const d = decideSwitchWrite(mode, 'preampgain');
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.error).toMatch(/Unknown channel switch/);
    }
  });

  it('refuses non-string switch names', () => {
    for (const bad of [undefined, null, 7, { name: 'phantom' }, ['phantom']]) {
      expect(decideSwitchWrite('edit', bad).allowed).toBe(false);
    }
  });

  // The point of the module: one decision, two call sites.
  it('gives MIDI and the UI the same answer', () => {
    const fromUi = decideSwitchWrite('run', 'phantom');
    const fromMidi = decideSwitchWrite('run', 'phantom');
    expect(fromMidi).toEqual(fromUi);
  });
});

describe('decideGainWrite', () => {
  it('allows a finite value in Edit mode', () => {
    const d = decideGainWrite('edit', 20);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.decibels).toBe(20);
  });

  it('coerces a numeric string', () => {
    const d = decideGainWrite('edit', '12.5');
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.decibels).toBeCloseTo(12.5);
  });

  it('refuses any gain change in Run mode', () => {
    const d = decideGainWrite('run', 20);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.error).toMatch(/Run mode/);
  });

  it('refuses values that are not finite numbers', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'loud', undefined, {}, [], true]) {
      expect(decideGainWrite('edit', bad).allowed).toBe(false);
    }
  });

  // Number(null) and Number('') are 0, so without an explicit check a missing
  // value would be accepted and quietly set the gain to the range minimum.
  // Number(null), Number('') and Number([]) are all 0, so without a type check
  // a missing value would be accepted and quietly set the range minimum.
  it('refuses the values JavaScript would coerce to 0', () => {
    for (const bad of [null, '', '   ', []]) {
      expect(decideGainWrite('edit', bad).allowed).toBe(false);
    }
  });

  // Range clamping is the API's job; this only guards what reaches it.
  it('passes an out-of-range number through for the API to clamp', () => {
    const d = decideGainWrite('edit', 999);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.decibels).toBe(999);
  });
});

describe('decidePresetRecall', () => {
  it('allows a .channel preset in Edit mode', () => {
    const d = decidePresetRecall('edit', '07.Snare 1.Drum.channel');
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.presetFile).toBe('07.Snare 1.Drum.channel');
  });

  it('refuses recall in Run mode — it replaces the whole strip', () => {
    expect(decidePresetRecall('run', '07.Snare 1.Drum.channel').allowed).toBe(false);
  });

  it('refuses anything that is not a .channel file', () => {
    for (const bad of ['01.Showfile.proj', 'evil.sh', '', undefined, null, 42, ['x.channel']]) {
      expect(decidePresetRecall('edit', bad).allowed).toBe(false);
    }
  });
});

describe('asAppMode', () => {
  it('recognises run mode', () => {
    expect(asAppMode('run')).toBe('run');
  });

  // Anything unrecognised falls back to edit, which is the mode where the
  // renderer's own guards are active rather than assumed.
  it('treats anything else as edit', () => {
    for (const v of ['edit', 'RUN', '', undefined, null, 1, {}]) {
      expect(asAppMode(v)).toBe('edit');
    }
  });
});

import {
  clampCount,
  MAX_CHANNEL_COUNT,
  asChannelSwitch,
  CHANNEL_SWITCHES,
  RUN_MODE_BLOCKED_SWITCHES,
} from '../../src/main/ipc-validators';

describe('clampCount', () => {
  it('passes through a normal positive integer', () => {
    expect(clampCount(16)).toBe(16);
  });

  it('passes through the maximum boundary', () => {
    expect(clampCount(MAX_CHANNEL_COUNT)).toBe(MAX_CHANNEL_COUNT);
  });

  it('clamps values above the max to the max', () => {
    expect(clampCount(MAX_CHANNEL_COUNT + 1)).toBe(MAX_CHANNEL_COUNT);
  });

  it('clamps very large numbers to the max', () => {
    expect(clampCount(999999)).toBe(MAX_CHANNEL_COUNT);
  });

  it('clamps negative values to 0', () => {
    expect(clampCount(-1)).toBe(0);
  });

  it('floors float values', () => {
    expect(clampCount(7.9)).toBe(7);
  });

  it('accepts a custom max', () => {
    expect(clampCount(50, 32)).toBe(32);
    expect(clampCount(10, 32)).toBe(10);
  });

  it('returns 0 for NaN', () => {
    expect(clampCount(NaN)).toBe(0);
  });

  it('clamps Infinity to MAX_CHANNEL_COUNT', () => {
    expect(clampCount(Infinity)).toBe(MAX_CHANNEL_COUNT);
  });

  it('returns 0 for a string input', () => {
    expect(clampCount('banana' as any)).toBe(0);
  });

  it('returns 0 for null input', () => {
    expect(clampCount(null as any)).toBe(0);
  });
});

describe('asChannelSwitch', () => {
  it('accepts every switch the renderer menu offers', () => {
    for (const name of CHANNEL_SWITCHES) {
      expect(asChannelSwitch(name)).toBe(name);
    }
  });

  it('rejects an unknown name', () => {
    expect(asChannelSwitch('preampgain')).toBeNull();
    expect(asChannelSwitch('48v')).toBeNull();
  });

  // The renderer is the only caller today, but this is the boundary where a
  // compromised or buggy one would reach the mixer, so it takes nothing on trust.
  it('rejects non-string values', () => {
    expect(asChannelSwitch(undefined)).toBeNull();
    expect(asChannelSwitch(null)).toBeNull();
    expect(asChannelSwitch(7)).toBeNull();
    expect(asChannelSwitch({ toString: () => 'phantom' })).toBeNull();
    expect(asChannelSwitch(['phantom'])).toBeNull();
  });

  it('does not fall through to Object.prototype keys', () => {
    expect(asChannelSwitch('constructor')).toBeNull();
    expect(asChannelSwitch('__proto__')).toBeNull();
    expect(asChannelSwitch('toString')).toBeNull();
  });
});

describe('RUN_MODE_BLOCKED_SWITCHES', () => {
  it('blocks phantom power — it can damage ribbon microphones', () => {
    expect(RUN_MODE_BLOCKED_SWITCHES).toContain('phantom');
  });

  it('blocks polarity', () => {
    expect(RUN_MODE_BLOCKED_SWITCHES).toContain('polarity');
  });

  it('leaves the processor switches available during a performance', () => {
    for (const name of ['gate', 'compressor', 'eq', 'limiter'] as const) {
      expect(RUN_MODE_BLOCKED_SWITCHES).not.toContain(name);
    }
  });

  it('only names switches that actually exist', () => {
    for (const name of RUN_MODE_BLOCKED_SWITCHES) {
      expect(CHANNEL_SWITCHES).toContain(name);
    }
  });
});

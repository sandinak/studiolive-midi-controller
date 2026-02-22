import { clampCount, MAX_CHANNEL_COUNT } from '../../src/main/ipc-validators';

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

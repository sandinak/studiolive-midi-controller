/**
 * IPC input validation helpers.
 * Used to sanitize values received from the renderer process.
 */

export const MAX_CHANNEL_COUNT = 256;

/**
 * Clamp a `count` value received from the renderer to a safe range [0, max].
 * Handles NaN, Infinity, floats, and negative values.
 */
export function clampCount(value: unknown, max: number = MAX_CHANNEL_COUNT): number {
  if (value === Infinity) return max;
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(Math.max(0, n), max);
}

/**
 * The per-channel switches the renderer is allowed to write, and whether a
 * given one is safe to change while the interface is locked in Run mode.
 *
 * Phantom power is the one that can do physical harm — it can damage ribbon
 * microphones — so it is barred from Run mode entirely and the renderer asks
 * for confirmation on top of that. The processor in/out switches are audible
 * but harmless and recoverable, so they stay available during a performance,
 * which is when you actually want to drop a gate or bypass a compressor.
 */
export const CHANNEL_SWITCHES = [
  'phantom',
  'polarity',
  'mono',
  'gate',
  'compressor',
  'eq',
  'limiter',
] as const;

export type ChannelSwitchId = (typeof CHANNEL_SWITCHES)[number];

/** Switches refused while the app is in Run mode. */
export const RUN_MODE_BLOCKED_SWITCHES: readonly ChannelSwitchId[] = ['phantom', 'polarity'];

/** Narrow an unknown value from the renderer to a known switch name. */
export function asChannelSwitch(value: unknown): ChannelSwitchId | null {
  return (CHANNEL_SWITCHES as readonly string[]).includes(value as string)
    ? (value as ChannelSwitchId)
    : null;
}

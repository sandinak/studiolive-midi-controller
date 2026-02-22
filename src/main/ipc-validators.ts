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

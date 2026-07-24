// Shared helpers for the soak suite.

/** Force a GC pass if the runner exposed one (`node --expose-gc`). */
export function tryGc(): boolean {
  const gc = (global as any).gc as (() => void) | undefined;
  if (!gc) return false;
  // Two passes: the first frees, the second collects anything the first
  // promoted, giving a steadier heap reading.
  gc();
  gc();
  return true;
}

/** Resident JS heap in bytes after an optional GC. */
export function heapUsed(): number {
  return process.memoryUsage().heapUsed;
}

/** Count of active timers/handles the event loop is currently holding. */
export function activeHandleCount(): number {
  // getActiveResourcesInfo is Node 17+. Fall back to 0 (skip the assertion)
  // on anything older so the suite still runs.
  const fn = (process as any).getActiveResourcesInfo as (() => string[]) | undefined;
  return fn ? fn().length : -1;
}

/** Human-readable MB, one decimal. */
export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Print a labelled soak metric so a CI log / operator can see the actual
 * numbers, not just pass/fail. Kept to a single console.log line per metric.
 */
export function report(label: string, detail: string): void {
  // eslint-disable-next-line no-console
  console.log(`  [soak] ${label}: ${detail}`);
}

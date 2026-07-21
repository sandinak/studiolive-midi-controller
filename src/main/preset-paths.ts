/**
 * Preset filename handling.
 *
 * Preset names arrive from the renderer, and `path.join(dir, name + '.json')`
 * happily escapes `dir` when the name contains `../` or an absolute path.
 * Every preset path is derived here so the save/load handlers can't diverge
 * on how carefully they treat that input.
 */

import * as path from 'path';

/**
 * Reduce a user-supplied preset name to a safe filename stem: lowercase,
 * spaces to hyphens, and everything outside [a-z0-9-_] dropped. Path
 * separators and dots do not survive, so the result can never traverse.
 *
 * Returns null when nothing usable remains — callers must treat that as a
 * rejected name rather than falling back to a default.
 */
export function slugifyPresetName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  if (!slug) return null;
  // Leave room for the .json suffix within common filesystem limits.
  return slug.slice(0, 200);
}

/**
 * Build the on-disk path for `name` inside `dir`.
 * Returns null if the name doesn't slugify to anything usable.
 */
export function presetPathFor(dir: string, name: unknown): string | null {
  const slug = slugifyPresetName(name);
  if (!slug) return null;
  return path.join(dir, `${slug}.json`);
}

/**
 * True if `target` resolves to a location inside `dir`.
 * Used to keep renderer-supplied absolute paths from writing anywhere on
 * the filesystem. Compares resolved paths, so `..` segments and a trailing
 * separator on either argument are handled.
 */
export function isWithinDirectory(dir: string, target: string): boolean {
  const resolvedDir = path.resolve(dir);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedDir) return true;
  return resolvedTarget.startsWith(resolvedDir + path.sep);
}

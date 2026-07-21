/**
 * URL validation for shell.openExternal.
 *
 * openExternal hands the URL to the OS handler, so the scheme decides what
 * runs. `file:` opens local paths, and platform-specific schemes can launch
 * registered applications — neither is something renderer JavaScript should
 * be able to reach. Only ordinary web links are allowed through.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * True if `url` is a well-formed absolute URL with a web-safe scheme.
 * Everything else — file:, javascript:, data:, custom app schemes, relative
 * paths and malformed input — is rejected.
 */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  // Cap the length so a pathological string can't be handed to the OS.
  if (url.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // Relative or malformed — no scheme to vet.
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

/**
 * Redacting a console state dump.
 *
 * A dump of the live state tree is the most useful diagnostic this project can
 * produce — it is the only way to see what a given console and firmware
 * actually publish — and it is the thing people will paste into a bug report or
 * commit as a test fixture. It also contains a console's serial, its registered
 * owner, its network configuration and its remote-access code.
 *
 * So redaction is not an option a caller may forget. `redactStateDump` is the
 * only sanctioned way to get a dump out of the process, and it strips secrets
 * unconditionally; `anonymise` additionally removes the operator-authored text
 * (channel labels, scene and project names) that makes a dump safe to commit
 * but is exactly what you want to keep when debugging your own console.
 *
 * The rule list is deliberately an **allow-nothing default for the sensitive
 * roots**: `users`, `permissions` and `networksetup` are dropped wholesale
 * rather than field by field, because a firmware update that adds a field there
 * would otherwise leak it the first time someone shared a dump.
 */

/** What a redacted scalar is replaced with, so its presence is still visible. */
export const REDACTED = '[redacted]';

/**
 * Subtrees removed in their entirety.
 *
 * Whole roots rather than named leaves: each of these exists to hold
 * credentials, network identity or user accounts, so anything added to one
 * later is sensitive by default too.
 */
export const REDACTED_ROOTS: readonly string[] = [
  /** User accounts and their profiles. */
  'users',
  /** Holds `access_code` — the console's remote-access secret. */
  'permissions',
  /** IP, subnet, gateway, and scanned network names. */
  'networksetup',
];

/**
 * Individual paths replaced with `REDACTED`, as `/`-delimited globs.
 *
 * `*` matches one path segment, `**` matches any number. Keeping the key but
 * replacing the value means a reader can still tell the parameter exists, which
 * matters when the point of the dump is to find out what a console publishes.
 *
 * **Every rule is depth-independent** — it is matched against any suffix of a
 * path, so `global/mixer_serial` catches both `internal/global/mixer_serial`
 * and `cache/global/mixer_serial`. `Client.dumpState()` returns the tree twice,
 * once under each of those keys, and a rule anchored at the top level would
 * have matched neither. Rules are written without a leading any-depth prefix
 * for legibility; `redactStateDump` adds one.
 */
export const REDACTED_PATHS: readonly string[] = [
  // Device identity.
  'global/mixer_serial',
  'global/registered_user',
  'global/devicename',
  'global/mixer_name',
  // Named stageboxes and ear-mix units carry site names.
  'stageboxsetup/selected_name',
  'earmixsetup/selected_name',
  // Recording session metadata is free text about a specific event.
  'sdrecorder/session/artist',
  'sdrecorder/session/performance',
  'sdrecorder/session/location',
  'sdrecorder/session/title',
  'sdrecorder/session/path',
  'sdrecorder/sdcard/volume_label',
];

/**
 * Operator-authored text, removed only under `anonymise`.
 *
 * These are the fields that make a dump identifying — channel labels on a real
 * board name the people standing behind them — and simultaneously the fields a
 * backup exists to preserve. Hence the split: redaction for sharing,
 * anonymisation for committing.
 */
export const ANONYMISED_PATHS: readonly string[] = [
  '**/username',
  'filtergroup/*/name',
  'autofiltergroup/*/name',
  'mutegroup/*username',
  'presets/loaded_scene_name',
  'presets/loaded_scene_title',
  'presets/loaded_project_name',
  'presets/loaded_project_title',
];

/**
 * Match a `/`-delimited path against a glob supporting `*` (one segment) and
 * `**` (any number, including none).
 *
 * Written here rather than reused from the protocol library: that matcher is
 * tuned for its transform table, treats a trailing `**` as optional in ways
 * that suit value lookups, and is not exported. A redaction rule that silently
 * failed to match would leak, so the semantics are kept explicit and tested.
 */
export function pathMatchesGlob(path: string, glob: string): boolean {
  const pathSegments = path.split('/').filter(Boolean);
  const globSegments = glob.split('/').filter(Boolean);

  const match = (pi: number, gi: number): boolean => {
    if (gi === globSegments.length) return pi === pathSegments.length;

    const token = globSegments[gi];

    if (token === '**') {
      // Consume zero or more segments.
      for (let skip = 0; pi + skip <= pathSegments.length; skip++) {
        if (match(pi + skip, gi + 1)) return true;
      }
      return false;
    }

    if (pi >= pathSegments.length) return false;

    const segment = pathSegments[pi];
    if (token === '*') return match(pi + 1, gi + 1);

    // A `*` inside a token matches within the segment, which is how
    // `*username` catches `mutegroup1username`.
    if (token.includes('*')) {
      const pattern = new RegExp(
        `^${token.split('*').map(escapeRegExp).join('.*')}$`,
      );
      if (!pattern.test(segment)) return false;
      return match(pi + 1, gi + 1);
    }

    if (segment !== token) return false;
    return match(pi + 1, gi + 1);
  };

  return match(0, 0);
}

function escapeRegExp(s: string): string {
  // Character class ordered so `$` is never followed by `{`: that two-character
  // sequence inside a regex literal confuses the TypeScript transform into
  // reading it as a template-literal placeholder.
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export interface RedactOptions {
  /**
   * Also strip operator-authored text — channel labels, DCA and mute-group
   * names, loaded scene and project names. Required before committing a dump
   * as a fixture or attaching one to a public issue.
   */
  anonymise?: boolean;
}

export interface RedactionReport {
  /** Roots dropped entirely. */
  removedRoots: string[];
  /** Paths whose values were replaced. */
  redactedPaths: string[];
}

export interface RedactResult<T = unknown> {
  dump: T;
  report: RedactionReport;
}

/**
 * Return a redacted deep copy of a state dump.
 *
 * The input is never mutated — a caller holding the live tree must not have it
 * altered underneath them by a diagnostic.
 *
 * The report lists what was touched, so the output can be shown to whoever is
 * about to share it. "Trust me, it's clean" is not something a user should have
 * to take on faith about their own console's serial number.
 */
export function redactStateDump<T>(dump: T, options: RedactOptions = {}): RedactResult<T> {
  // Anchor every rule at "any depth" — see REDACTED_PATHS. Without this a rule
  // written as `global/mixer_serial` matches nothing in a real dump, which is a
  // leak that looks like a working redactor.
  const globs = [
    ...REDACTED_PATHS,
    ...(options.anonymise ? ANONYMISED_PATHS : []),
  ].map((glob) => (glob.startsWith('**/') ? glob : `**/${glob}`));

  const removedRoots: string[] = [];
  const redactedPaths: string[] = [];

  const walk = (node: unknown, path: string[]): unknown => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item, i) => walk(item, [...path, String(i)]));

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const nextPath = [...path, key];
      const joined = nextPath.join('/');

      // A sensitive root is dropped wherever it appears, not only at depth 0:
      // `dumpState()` nests the tree under `internal` and `cache`, so anchoring
      // to the top level would miss both copies.
      if (REDACTED_ROOTS.includes(key)) {
        removedRoots.push(joined);
        continue;
      }

      if (globs.some((glob) => pathMatchesGlob(joined, glob))) {
        redactedPaths.push(joined);
        // Objects are emptied rather than stringified, so the shape survives.
        out[key] = value !== null && typeof value === 'object' ? {} : REDACTED;
        continue;
      }

      out[key] = walk(value, nextPath);
    }
    return out;
  };

  return {
    dump: walk(dump, []) as T,
    report: {
      removedRoots: [...new Set(removedRoots)].sort(),
      redactedPaths: [...new Set(redactedPaths)].sort(),
    },
  };
}

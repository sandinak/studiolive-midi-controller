/**
 * Serialising a console document the way the console does.
 *
 * `JSON.stringify` produces a semantically identical document and a textually
 * very different one. Measured against a real 16R scene: of 4,429 numeric
 * literals, **3,965 change their printed form**. Two reasons, and only one of
 * them is cosmetic.
 *
 *   1. Precision. The console prints the full decimal expansion of a 32-bit
 *      float — `59.434925079345703125` — where JavaScript prints the shortest
 *      form that round-trips as a double, `59.4349250793457`. Both parse back to
 *      the same float32 once the console narrows them, so this is safe to lose.
 *
 *   2. **Float-ness.** The console writes `130.0` and `-84.0`; `JSON.stringify`
 *      writes `130` and `-84`, because JavaScript has one number type and drops
 *      a trailing `.0`. A strict or hand-rolled reader that expects a decimal
 *      point where the schema says float would reject that. We do not know what
 *      the console's parser does, and a backup is the wrong place to find out.
 *
 * So integral floats keep their `.0`, driven by `FLOAT_KEYS` below. The layout
 * (tabs, and an object's brace on its own line after `"key": `) is matched too —
 * it costs nothing and it keeps an authored document diffable against a
 * console-written one.
 *
 * **Prefer not to re-serialise at all.** A document being carried through
 * unchanged should be passed as the original bytes; see `console-backup-writer`.
 * This module is for documents that are authored or modified, where there are no
 * original bytes to preserve.
 */

/**
 * Keys whose values the console prints as floats.
 *
 * Derived by scanning 202 real documents from a 16R and a 32R for the *printed*
 * form of every numeric literal, so this is observation rather than a guess
 * about the console's schema. Fifteen keys were seen printed both ways — a float
 * that happened to hold a whole number — and are included here: printing `0.0`
 * where the console printed `0` is the same JSON number, whereas printing `0`
 * where a float was expected is the failure mode worth avoiding.
 *
 * A key not listed here is printed as an integer. An unknown key therefore
 * defaults to integer, which is correct for the overwhelming majority (444 of
 * 619 observed keys) — and `serialiseConsoleDocument` can report what it saw so
 * a new float key does not stay unnoticed.
 */
export const FLOAT_KEYS: ReadonlySet<string> = new Set([
  'attack', 'busdelay', 'centerdiv', 'delay', 'delay_l', 'delay_r',
  'diffusion', 'digitalgain', 'dly_offset_l', 'dly_offset_r', 'fb_hpf', 'fb_l',
  'fb_l_hpf', 'fb_l_lpf', 'fb_lpf', 'fb_r', 'fb_r_hpf', 'fb_r_lpf',
  'feedback', 'freq', 'gain', 'hfdamp_freq', 'hfdamp_gain', 'hpf',
  'keyfilter', 'level', 'lfdamp_freq', 'lfdamp_gain', 'lpf', 'mon_delay',
  'monolevel', 'pan', 'phones_delay', 'preampgain', 'predelay', 'range',
  'ratio', 'reflection', 'release', 'size', 'solo_level', 'spread',
  'stereopan', 'threshold', 'trim', 'volume',
]);

/**
 * Numbered families of float keys — send levels, EQ bands, GEQ bands — listed as
 * patterns so the set does not have to enumerate `aux1` through `aux32` and
 * `gain1` through `gain31` for every console size.
 */
export const FLOAT_KEY_PATTERNS: readonly RegExp[] = [
  /^aux\d+$/,
  /^aux\d+_pan$/,
  /^aux\d+_stpan$/,
  /^fx\d+$/,
  /^gain\d+$/,
  /^eqfreq\d+$/,
  /^eqgain\d+$/,
  /^eqq\d+$/,
  /^FX[A-H]$/,
];

/** True when the console prints this key's value with a decimal point. */
export function isFloatKey(key: string): boolean {
  if (FLOAT_KEYS.has(key)) return true;
  return FLOAT_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Format one number the way the console would.
 *
 * Non-finite values are refused rather than emitted: `JSON.stringify` turns
 * NaN and Infinity into `null`, which would land in a document as a silently
 * wrong parameter.
 */
export function formatConsoleNumber(key: string, value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${key}: refusing to serialise a non-finite number (${value})`);
  }
  if (!isFloatKey(key)) {
    // An integer-typed key holding a fraction means the caller has the wrong
    // type for it, which is worth surfacing rather than truncating.
    if (!Number.isInteger(value)) return floatLiteral(value);
    return String(value);
  }
  return floatLiteral(value);
}

function floatLiteral(value: number): string {
  // Integral floats keep a trailing `.0`; everything else uses the shortest
  // round-tripping form, which is what JSON.stringify already gives.
  return Number.isInteger(value) ? `${value}.0` : JSON.stringify(value);
}

export interface SerialiseOptions {
  /**
   * Collects keys whose value was a non-integral number but which are not in
   * `FLOAT_KEYS` — i.e. float keys this project has not observed yet. Passing a
   * set here is how a caller notices the registry has gone stale.
   */
  unknownFloatKeys?: Set<string>;
}

/**
 * Serialise a document in the console's own style.
 *
 * Layout, matching a console-written file: tab indentation, `"key": ` followed
 * by a newline and the opening brace on its own line for nested objects, and
 * `"key": value` on one line for scalars.
 */
export function serialiseConsoleDocument(
  document: unknown,
  options: SerialiseOptions = {},
): string {
  const { unknownFloatKeys } = options;

  const write = (node: unknown, key: string, depth: number): string => {
    const pad = '\t'.repeat(depth);

    if (node === null) return 'null';

    if (typeof node === 'number') {
      if (unknownFloatKeys && !Number.isInteger(node) && !isFloatKey(key)) {
        unknownFloatKeys.add(key);
      }
      return formatConsoleNumber(key, node);
    }

    if (typeof node === 'string') return JSON.stringify(node);
    if (typeof node === 'boolean') return node ? '1' : '0';

    if (Array.isArray(node)) {
      if (node.length === 0) return `[\n\n${pad}]`;
      const items = node
        .map((item) => `${pad}\t${write(item, key, depth + 1)}`)
        .join(',\n');
      return `[\n${items}\n${pad}]`;
    }

    if (typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      // An empty object is a block with a blank body, not `{}` — a real scene
      // contains `"opt": \n{\n\n}` and no bare `{}` anywhere. Matching it keeps
      // an authored document diffable against a console-written one.
      if (entries.length === 0) return `{\n\n${pad}}`;
      const body = entries
        .map(([childKey, value]) => {
          const rendered = write(value, childKey, depth + 1);
          // An object or array gets its bracket on the next line, which is how
          // the console lays them out; a scalar stays on the key's line.
          const isBlock = rendered.startsWith('{\n') || rendered.startsWith('[\n');
          return isBlock
            ? `${pad}\t${JSON.stringify(childKey)}: \n${pad}\t${rendered}`
            : `${pad}\t${JSON.stringify(childKey)}: ${rendered}`;
        })
        .join(',\n');
      return `{\n${body}\n${pad}}`;
    }

    // undefined and functions have no JSON representation; dropping them
    // silently would lose a parameter.
    throw new TypeError(`${key}: cannot serialise a value of type ${typeof node}`);
  };

  return write(document, '', 0);
}

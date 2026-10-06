/**
 * The console's own configuration document format.
 *
 * A StudioLive III "mixer backup" is a ZIP of JSON documents — the same files
 * Universal Control writes. The shapes here were derived by dissecting real
 * backups from a 16R and a 32R (133 documents); see
 * docs/config-backup-restore-plan.md §1.4 for the evidence.
 *
 * Two properties of these documents drive the design of this module:
 *
 *   1. Every leaf is a JSON number or string. No booleans, no arrays, no
 *      nesting beyond `root / chN / section / key`. Flags are 0/1 numbers.
 *
 *   2. The key set is model- and firmware-dependent, and the vendor adds to it.
 *      The protocol library's hand-transcribed state-tree type has already gone
 *      stale this way — it is missing `sub`, `mapping` and
 *      `global.mastermixlock`, all of which appear in real documents.
 *
 * So the interfaces below name the fields we actually reason about and carry
 * everything else through an index signature. **A backup must never drop a key
 * it does not recognise** — that would silently lose console configuration, and
 * an unknown field is exactly the case where silence is most expensive. Parsed
 * documents therefore stay structurally intact, and the typed members are a
 * reading aid rather than a filter.
 */

/**
 * Which kind of document this is. The console distinguishes these by file
 * extension and by where they sit in a backup archive — they are *not*
 * interchangeable, because their scopes differ (see `DOCUMENT_ROOTS`).
 */
export type ConsoleDocumentKind =
  /** `Scene/*.scene` — a standalone scene: mix state, scene filters, GEQ, patching. */
  | 'scene'
  /** `Project/<p>.proj/*.scn` — a scene inside a project: mix state only. */
  | 'scn'
  /** `Project/<p>.proj/*.cnfg` — project config. The only document carrying `global`. */
  | 'cnfg'
  /** `Fat/*.channel` — a channel preset: processing only, no label/colour/gain. */
  | 'channel'
  /** `FX/*.fx` — an FX preset. */
  | 'fx';

/**
 * Roots observed in each document kind, from the two reference backups.
 *
 * The practical consequence: **a complete capture needs `cnfg` + `scn`**.
 * `global` — sample rate, DCA/pan mode, the `fltr*` scene-filter flags,
 * `mastermixlock` — appears only in a project config, so a scene alone is not a
 * full picture of the console.
 *
 * Treat these as "seen in real data", not as a closed set; a different model or
 * firmware may add roots, and the reader tolerates that.
 */
export const DOCUMENT_ROOTS: Record<ConsoleDocumentKind, readonly string[]> = {
  scene: [
    'advancedscenefilters', 'projectfilters', 'mapping', 'mutegroup',
    'outputpatchrouter', 'stageboxsetup', 'line', 'return', 'talkback',
    'signalgen', 'aux', 'sub', 'fxbus', 'fxreturn', 'main', 'geq',
    'filtergroup', 'fx',
  ],
  scn: [
    'line', 'return', 'talkback', 'aux', 'fxbus', 'fxreturn', 'main',
    'filtergroup', 'autofiltergroup', 'mutegroup', 'fx', 'signalgen',
  ],
  cnfg: [
    'global', 'mastersection', 'line', 'return', 'talkback', 'aux', 'fxbus',
    'fxreturn', 'main', 'geq', 'outputpatchrouter', 'stageboxsetup',
  ],
  channel: ['filter', 'gate', 'comp', 'limit', 'eq'],
  fx: ['plugin', 'preset_name'],
} as const;

/** Channel-type roots that hold `chN` children. */
export const CHANNEL_ROOTS = [
  'line', 'return', 'talkback', 'aux', 'sub', 'fxbus', 'fxreturn', 'main',
  'geq', 'filtergroup', 'autofiltergroup', 'fx',
] as const;

export type ChannelRoot = (typeof CHANNEL_ROOTS)[number];

/**
 * A processing block. `__classid` is the DSP component GUID — identical across
 * the AI and III generations, so it identifies the algorithm rather than the
 * console.
 */
export interface ProcessingBlock {
  __classid?: string;
  [key: string]: unknown;
}

/**
 * One channel strip, as stored in a document.
 *
 * Units are the console's own and are *real engineering units*, unlike the
 * 0–1 fractions the wire protocol uses for the same parameters. That asymmetry
 * is the single most useful thing about this format: it is what makes a
 * cross-model transfer a value-preserving transform rather than a guess.
 */
export interface ChannelStrip {
  /** User label — the scribble-strip text. Empty-ish default is `"Ch. 1"`. */
  username?: string;
  /** Unsigned 32-bit ARGB. `0` means unset. Use `argbToHex`. */
  color?: number;
  /** Structured `category/name`, e.g. `keyboards/piano`. `''` when unset. */
  iconid?: string;

  /** Fader position in **dB** (−84 … +10), not a 0–1 fraction. */
  volume?: number;
  mute?: number;
  solo?: number;
  /** 0–1, where 0.5 is centre. */
  pan?: number;
  stereopan?: number;

  link?: number;
  linkmaster?: number;
  linkoptions?: { [key: string]: unknown };

  /** Preamp gain in **dB**. */
  preampgain?: number;
  digitalgain?: number;
  '48v'?: number;
  polarity?: number;
  '10db_boost'?: number;

  /** High-pass corner in **Hz**. 24 Hz is the minimum, i.e. effectively off. */
  filter?: { hpf?: number;[key: string]: unknown };
  /** Thresholds in dB, attack/release in **seconds**, keyfilter in Hz. */
  gate?: ProcessingBlock;
  /** Threshold and gain in dB, attack/release in seconds, ratio as a ratio. */
  comp?: ProcessingBlock;
  /** Gains in dB, frequencies in **Hz**, Q as Q. Band count varies — see below. */
  eq?: ProcessingBlock;
  limit?: ProcessingBlock;
  opt?: { [key: string]: unknown };
  /** A/B memory — the alternate strip stored alongside the active one. */
  altmem?: { [key: string]: unknown };
  /** The DCA-contributed component of this channel's levels. */
  dca?: { [key: string]: unknown };

  [key: string]: unknown;
}

/** A root holding `chN` children. */
export type ChannelCollection = Record<string, ChannelStrip>;

/**
 * A parsed document. Deliberately permissive — see the module docblock.
 */
export type ConsoleDocument = Record<string, unknown>;

/** Where a document sat in the archive, and what it parsed to. */
export interface BackupEntry {
  /** Path inside the ZIP, e.g. `Project/01.PHS-Choir.proj/01.Starting.scn`. */
  path: string;
  kind: ConsoleDocumentKind;
  /** Project directory name (`01.PHS-Choir.proj`) for `scn`/`cnfg`, else null. */
  project: string | null;
  /** Display name derived from the filename, with the `NN.` prefix removed. */
  name: string;
  document: ConsoleDocument;
}

/** A read backup archive. */
export interface ConsoleBackup {
  /** Source file path, when read from disk. */
  source?: string;
  entries: BackupEntry[];
  /** Entries that did not parse, with the reason. Never silently dropped. */
  failures: { path: string; reason: string }[];
}

// ─── Colour ────────────────────────────────────────────────────────────────

/**
 * Convert the console's colour integer to a CSS hex string.
 *
 * Colours are stored as unsigned 32-bit **ARGB** — `4278190335` is
 * `0xFF0000FF`, pure blue at full alpha. `0` has zero alpha and means "no
 * colour set", which is distinct from black, so it returns null rather than
 * `#000000`.
 *
 * Note this is a different byte order from the protocol library's `**.color`
 * transform, which writes an Int32 little-endian and reads the bytes back as
 * hex. The two must not be confused.
 */
export function argbToHex(color: unknown): string | null {
  if (typeof color !== 'number' || !Number.isFinite(color)) return null;
  const v = color >>> 0;
  if (v === 0) return null;
  const r = (v >>> 16) & 0xff;
  const g = (v >>> 8) & 0xff;
  const b = v & 0xff;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Alpha byte of a colour, 0–255. `0` indicates an unset colour. */
export function argbAlpha(color: unknown): number | null {
  if (typeof color !== 'number' || !Number.isFinite(color)) return null;
  return ((color >>> 0) >>> 24) & 0xff;
}

/**
 * Build a console colour integer from a CSS hex string. Accepts `#rgb`,
 * `#rrggbb` and `#aarrggbb`; defaults alpha to opaque, since an alpha of zero
 * would read back as "unset".
 */
export function hexToArgb(hex: unknown): number | null {
  if (typeof hex !== 'string') return null;
  let s = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/i.test(s)) s = `ff${s}`;
  if (!/^[0-9a-f]{8}$/i.test(s)) return null;
  return Number.parseInt(s, 16) >>> 0;
}

// ─── Icons ─────────────────────────────────────────────────────────────────

/**
 * Split an `iconid` into its category and name.
 *
 * Real values are two-level paths — `keyboards/piano`, `guitars/electric2`,
 * `other/iem`, `drums/drumpad` — so they can be matched exactly rather than by
 * keyword. Returns null for the empty string the console uses when no icon is
 * assigned.
 */
export function parseIconId(
  iconid: unknown,
): { category: string; name: string } | null {
  if (typeof iconid !== 'string') return null;
  const trimmed = iconid.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    return { category: '', name: trimmed };
  }
  return {
    category: trimmed.slice(0, slash),
    name: trimmed.slice(slash + 1),
  };
}

// ─── Labels ────────────────────────────────────────────────────────────────

/**
 * Strip the console's `N:` index prefix from a label.
 *
 * Aux labels in real documents come through as `1:Ear-ALL`, `2:Ear-Bass`. The
 * renderer already strips this when reading live state; documents need the same
 * treatment, so the rule lives here and both paths can share it.
 */
export function stripLabelPrefix(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const match = /^\d+:(.*)$/.exec(label);
  return (match ? match[1] : label).trim() || null;
}

// ─── Structure helpers ─────────────────────────────────────────────────────

const CHANNEL_KEY = /^ch(\d+)$/;

/**
 * Channel numbers present under a root, ascending. Reads the document rather
 * than assuming a count — the 16R has 6 auxes and 8 DCAs where the 32R has 16
 * and 24, and the renderer's hard-coded 8 is wrong for the latter.
 */
export function channelNumbers(collection: unknown): number[] {
  if (!collection || typeof collection !== 'object') return [];
  const nums: number[] = [];
  for (const key of Object.keys(collection as object)) {
    const m = CHANNEL_KEY.exec(key);
    if (m) nums.push(Number(m[1]));
  }
  return nums.sort((a, b) => a - b);
}

/**
 * Per-root channel counts for a document — the shape of the console that wrote
 * it. This is how a restore decides what the target can accept.
 */
export function documentChannelCounts(doc: ConsoleDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const root of CHANNEL_ROOTS) {
    const n = channelNumbers(doc[root]).length;
    if (n > 0) counts[root] = n;
  }
  return counts;
}

/**
 * How many EQ bands a strip carries.
 *
 * Band count is channel-type dependent — `line` has 4, `aux` has 6 — so
 * anything iterating bands must read it from the data. Counts `eqfreqN` keys,
 * which every band has (`eqbandop` appears only on the outer two).
 */
export function eqBandCount(eq: unknown): number {
  if (!eq || typeof eq !== 'object') return 0;
  let n = 0;
  for (const key of Object.keys(eq as object)) {
    if (/^eqfreq\d+$/.test(key)) n++;
  }
  return n;
}

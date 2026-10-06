/**
 * A minimal ZIP writer, for building fixtures.
 *
 * The reader under test must work on real console backups, but those contain
 * channel labels, project names and operator names from live boards, so none of
 * them can be committed. Fixtures are therefore synthesised here, which also
 * makes it possible to construct the malformed archives the reader has to
 * reject — something a captured file cannot provide.
 *
 * Writes both stored and deflated entries so both branches of
 * `readZipEntry` are exercised. CRCs are left zero: the reader checks declared
 * sizes rather than checksums, and a fixture builder that silently disagreed
 * with the reader about CRC would test the builder, not the reader.
 */

import * as zlib from 'zlib';

export interface ZipInput {
  name: string;
  /** Entry contents. A string is encoded as UTF-8. */
  content: string | Buffer;
  /** Store instead of deflating. Default is to deflate. */
  store?: boolean;
}

interface Staged {
  name: Buffer;
  data: Buffer;
  uncompressedSize: number;
  method: number;
  localHeaderOffset: number;
}

function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}

function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return b;
}

/** Build a valid ZIP archive from the given entries. */
export function buildZip(inputs: ZipInput[]): Buffer {
  const parts: Buffer[] = [];
  const staged: Staged[] = [];
  let offset = 0;

  for (const input of inputs) {
    const name = Buffer.from(input.name, 'utf8');
    const raw = Buffer.isBuffer(input.content)
      ? input.content
      : Buffer.from(input.content, 'utf8');
    const store = input.store === true || input.name.endsWith('/');
    const data = store ? raw : zlib.deflateRawSync(raw);
    const method = store ? 0 : 8;

    const header = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(method),
      u16(0), u16(0), // mod time, date
      u32(0), // crc32 — not checked by the reader
      u32(data.length),
      u32(raw.length),
      u16(name.length),
      u16(0), // extra length
      name,
    ]);

    staged.push({
      name,
      data,
      uncompressedSize: raw.length,
      method,
      localHeaderOffset: offset,
    });

    parts.push(header, data);
    offset += header.length + data.length;
  }

  const centralOffset = offset;
  let centralSize = 0;

  for (const entry of staged) {
    const record = Buffer.concat([
      u32(0x02014b50),
      u16(20), u16(20), // version made by, needed
      u16(0), // flags
      u16(entry.method),
      u16(0), u16(0), // mod time, date
      u32(0), // crc32
      u32(entry.data.length),
      u32(entry.uncompressedSize),
      u16(entry.name.length),
      u16(0), u16(0), // extra, comment length
      u16(0), // disk start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(entry.localHeaderOffset),
      entry.name,
    ]);
    parts.push(record);
    centralSize += record.length;
  }

  parts.push(Buffer.concat([
    u32(0x06054b50),
    u16(0), u16(0), // disk numbers
    u16(staged.length), u16(staged.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0), // comment length
  ]));

  return Buffer.concat(parts);
}

// ─── Synthetic console documents ───────────────────────────────────────────

/** A channel strip with the fields the reader and helpers care about. */
export function makeChannel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    username: 'Ch. 1',
    color: 0,
    iconid: '',
    volume: -84.0,
    mute: 0,
    pan: 0.5,
    link: 0,
    preampgain: 0.0,
    '48v': 0,
    polarity: 0,
    filter: { hpf: 24.0 },
    gate: { on: 0, threshold: -84.0, attack: 0.005, release: 0.7 },
    comp: {
      on: 0, threshold: 0.0, ratio: 2.0, gain: 0.0,
      __classid: '{870D04F7-212E-4F9C-ADBB-39A97216433F}',
    },
    eq: {
      eqallon: 1,
      eqgain1: 0.0, eqq1: 0.6, eqfreq1: 130.0, eqbandon1: 1,
      eqgain2: 0.0, eqq2: 0.6, eqfreq2: 500.0, eqbandon2: 1,
      eqgain3: 0.0, eqq3: 0.6, eqfreq3: 2000.0, eqbandon3: 1,
      eqgain4: 0.0, eqq4: 0.6, eqfreq4: 5000.0, eqbandon4: 1,
      __classid: '{A0A8A068-14F0-4B04-BB6F-AF8329D0E8EE}',
    },
    limit: { limiteron: 0, threshold: 0.0 },
    ...overrides,
  };
}

function channels(count: number, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 1; i <= count; i++) {
    out[`ch${i}`] = makeChannel({ username: `${prefix} ${i}` });
  }
  return out;
}

/** A `.scn`-shaped document: mix state only. */
export function makeScn(lineCount = 16, auxCount = 6): Record<string, unknown> {
  return {
    line: channels(lineCount, 'Ch.'),
    aux: channels(auxCount, 'Aux'),
    main: { ch1: makeChannel({ username: 'Main' }) },
    filtergroup: { ch1: { name: 'DCA 1', iconid: '', volume: 0.0 } },
    mutegroup: {
      mutegroup1username: 'Mute Group 1',
      mutegroup1mutes: '',
      safe_mutes: '',
    },
  };
}

/** A `.cnfg`-shaped document: the only kind carrying `global`. */
export function makeCnfg(): Record<string, unknown> {
  return {
    global: { samplerate: 1, dcamode: 0, panmode: 0, mastermixlock: 0 },
    mastersection: { anysolo: 0 },
    geq: { ch1: { gain1: 0.0 } },
    outputpatchrouter: { mix1_src: 0 },
    stageboxsetup: { avb_clocksrc: 0 },
  };
}

/** A `.channel` preset: processing only — no label, colour, gain or phantom. */
export function makeChannelPreset(): Record<string, unknown> {
  const c = makeChannel();
  return { filter: c.filter, gate: c.gate, comp: c.comp, limit: c.limit, eq: c.eq };
}

export interface BackupFixtureOptions {
  /** Include a `Project/` directory with a scene and config. Default true. */
  withProject?: boolean;
  lineCount?: number;
  auxCount?: number;
  /** Number of `Fat/*.channel` presets. Default 2. */
  channelPresets?: number;
}

/**
 * Build a backup archive shaped like a real one.
 *
 * `withProject: false` reproduces the case that matters most — an archive
 * holding only the factory library, because nobody stored a scene before
 * backing the console up.
 */
export function buildBackupFixture(options: BackupFixtureOptions = {}): Buffer {
  const {
    withProject = true,
    lineCount = 16,
    auxCount = 6,
    channelPresets = 2,
  } = options;

  const entries: ZipInput[] = [];

  for (let i = 1; i <= channelPresets; i++) {
    entries.push({
      name: `Fat/${String(i).padStart(2, '0')}.Preset ${i}.Drum.channel`,
      content: JSON.stringify(makeChannelPreset()),
    });
  }

  entries.push({
    name: 'FX/01.Dry Slap Delay.Mono_Delay.fx',
    content: JSON.stringify({
      plugin: { type: 0, __classid: '{5D80F75E-628E-FF6F-9B7B-BCB8174A997B}' },
      preset_name: 'Dry Slap Delay',
    }),
  });

  entries.push({
    name: 'Scene/01.Zero Out (Board Reset).scene',
    content: JSON.stringify({
      ...makeScn(lineCount, auxCount),
      advancedscenefilters: { fltr_channel_info: 1 },
      projectfilters: { fltr_dspmodels: 1 },
      geq: { ch1: { gain1: 0.0 } },
      outputpatchrouter: { mix1_src: 0 },
    }),
  });

  if (withProject) {
    entries.push({
      name: 'Project/01.Sunday.proj/01.Starting.scn',
      content: JSON.stringify(makeScn(lineCount, auxCount)),
    });
    entries.push({
      name: 'Project/01.Sunday.proj/Sunday.cnfg',
      content: JSON.stringify(makeCnfg()),
    });
  }

  return buildZip(entries);
}

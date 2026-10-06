/**
 * Writing a backup archive.
 *
 * The archive is meant to be opened by Universal Control and the console, not
 * only by our own reader, so the tests that matter most are the ones that pin
 * things our reader does not check: CRC-32, and the agreement between the path
 * the writer produces and the path the reader parses back.
 *
 * The CRC implementation has a stronger check than anything here — it was
 * verified against the checksums the vendor stored in two real archives, 133
 * entries, zero mismatches. These cover the behaviour around it.
 */

import * as zlib from 'zlib';
import {
  buildZip,
  crc32,
  toDosDateTime,
  ZipWriteError,
  MAX_ENTRIES,
} from '../../src/main/zip-writer';
import { listZipEntries, readZipEntry } from '../../src/main/zip-reader';
import {
  buildBackupArchive,
  backupEntryPath,
  rebuildBackupArchive,
  BackupWriteError,
} from '../../src/main/console-backup-writer';
import { parseBackupArchive, summariseBackup } from '../../src/main/console-backup';
import { makeScn, makeCnfg, makeChannelPreset } from '../helpers/zip-builder';

describe('crc32', () => {
  // Published check values for the CRC-32 the ZIP format uses.
  it.each([
    ['', 0],
    ['a', 0xe8b7be43],
    ['abc', 0x352441c2],
    ['123456789', 0xcbf43926],
  ])('matches the known value for %p', (input, expected) => {
    expect(crc32(Buffer.from(input))).toBe(expected);
  });

  it('is stable across calls, so the table is not corrupted by reuse', () => {
    const first = crc32(Buffer.from('check'));
    crc32(Buffer.from('something else entirely'));
    expect(crc32(Buffer.from('check'))).toBe(first);
  });

  it('handles bytes above 0x7f', () => {
    expect(crc32(Buffer.from([0xff, 0x80, 0x00]))).toBeGreaterThan(0);
  });
});

describe('toDosDateTime', () => {
  it('packs a date into the DOS format', () => {
    const { date } = toDosDateTime(new Date(2026, 9, 6, 12, 30, 20));
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(10);
    expect(date & 0x1f).toBe(6);
  });

  it('has two-second resolution', () => {
    const { time } = toDosDateTime(new Date(2026, 0, 1, 1, 2, 7));
    expect((time & 0x1f) * 2).toBe(6);
  });

  // A wrapped date reads as a corrupt archive, so out-of-range clamps.
  it('clamps a date before the 1980 epoch', () => {
    const { date } = toDosDateTime(new Date(1970, 0, 1));
    expect((date >> 9) + 1980).toBe(1980);
  });
});

describe('buildZip', () => {
  it('produces an archive our own reader accepts', () => {
    const zip = buildZip([{ name: 'a.json', content: '{"a":1}' }]);
    const entries = listZipEntries(zip);
    expect(entries).toHaveLength(1);
    expect(readZipEntry(zip, entries[0]).toString()).toBe('{"a":1}');
  });

  it('stores the correct CRC in the local and central headers', () => {
    const payload = Buffer.from('{"check":true}');
    const zip = buildZip([{ name: 'a.json', content: payload }]);
    const expected = crc32(payload);
    const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
    expect(zip.readUInt32LE(centralOffset + 16)).toBe(expected);
    // Local header CRC sits at offset 14.
    expect(zip.readUInt32LE(14)).toBe(expected);
  });

  it('deflates by default and stores on request', () => {
    const payload = 'x'.repeat(2000);
    const deflated = buildZip([{ name: 'a', content: payload }]);
    const stored = buildZip([{ name: 'a', content: payload, store: true }]);
    expect(deflated.length).toBeLessThan(stored.length);
    expect(listZipEntries(deflated)[0].compressionMethod).toBe(8);
    expect(listZipEntries(stored)[0].compressionMethod).toBe(0);
  });

  it('flags names as UTF-8 so a non-ASCII scene name survives', () => {
    const zip = buildZip([{ name: 'Scene/01.Café.scene', content: '{}' }]);
    expect(listZipEntries(zip)[0].name).toBe('Scene/01.Café.scene');
    // Bit 11 of the general-purpose flags, in the local header at offset 6.
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
  });

  it('preserves entry order, which is slot order in a console library', () => {
    const names = ['Fat/02.B.Drum.channel', 'Fat/01.A.Drum.channel', 'Scene/01.S.scene'];
    const zip = buildZip(names.map((name) => ({ name, content: '{}' })));
    expect(listZipEntries(zip).map((e) => e.name)).toEqual(names);
  });

  it('round-trips an empty archive', () => {
    expect(listZipEntries(buildZip([]))).toEqual([]);
  });

  it('marks a directory entry', () => {
    const zip = buildZip([{ name: 'Scene/', content: '' }]);
    expect(listZipEntries(zip)[0].isDirectory).toBe(true);
  });

  it('round-trips a payload large enough to span deflate blocks', () => {
    const payload = JSON.stringify({ pad: 'abc'.repeat(100_000) });
    const zip = buildZip([{ name: 'big.json', content: payload }]);
    const [entry] = listZipEntries(zip);
    expect(readZipEntry(zip, entry).toString()).toBe(payload);
  });

  it('is byte-identical for the same input and timestamp', () => {
    const date = new Date(2026, 9, 6, 12, 0, 0);
    const of = () => buildZip([{ name: 'a.json', content: '{"a":1}', date }]);
    expect(of().equals(of())).toBe(true);
  });

  describe('refusals', () => {
    // Refuse at write time what we would refuse at read time, rather than
    // producing something that fails confusingly later.
    it.each([
      ['an empty name', ''],
      ['an absolute path', '/etc/passwd'],
      ['a parent segment', '../escape.json'],
      ['a drive letter', 'C:\\x.json'],
      ['a null byte', 'a\0.json'],
    ])('rejects %s', (_label, name) => {
      expect(() => buildZip([{ name, content: '{}' }])).toThrow(ZipWriteError);
    });

    it('rejects duplicate names', () => {
      expect(() => buildZip([
        { name: 'a.json', content: '{}' },
        { name: 'a.json', content: '{}' },
      ])).toThrow(/duplicate entry name/);
    });

    it('rejects more entries than the reader would accept', () => {
      const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({
        name: `f${i}`, content: '{}',
      }));
      expect(() => buildZip(entries)).toThrow(/too many entries/);
    });

    it('rejects a non-array', () => {
      expect(() => buildZip(null as never)).toThrow(ZipWriteError);
    });
  });

  it('writes a stream the platform zlib can inflate', () => {
    // Cross-checks our framing against a second implementation.
    const payload = Buffer.from(JSON.stringify(makeScn(2, 2)));
    const zip = buildZip([{ name: 'a.json', content: payload }]);
    const [entry] = listZipEntries(zip);
    const nameLength = zip.readUInt16LE(entry.localHeaderOffset + 26);
    const start = entry.localHeaderOffset + 30 + nameLength;
    const raw = zip.subarray(start, start + entry.compressedSize);
    expect(zlib.inflateRawSync(raw).equals(payload)).toBe(true);
  });
});

describe('backupEntryPath', () => {
  it.each([
    [{ kind: 'channel' as const, name: 'Kick 1', slot: 1, category: 'Drum' },
      'Fat/01.Kick 1.Drum.channel'],
    [{ kind: 'fx' as const, name: 'Dry Slap Delay', slot: 1, category: 'Mono_Delay' },
      'FX/01.Dry Slap Delay.Mono_Delay.fx'],
    [{ kind: 'scene' as const, name: 'Zero Out (Board Reset)', slot: 1 },
      'Scene/01.Zero Out (Board Reset).scene'],
    [{ kind: 'scn' as const, name: 'Starting', slot: 1, project: '01.Sunday.proj' },
      'Project/01.Sunday.proj/01.Starting.scn'],
    [{ kind: 'cnfg' as const, name: 'Sunday', project: '01.Sunday.proj' },
      'Project/01.Sunday.proj/Sunday.cnfg'],
  ])('builds %o', (entry, expected) => {
    expect(backupEntryPath({ ...entry, document: {} })).toBe(expected);
  });

  it('pads the slot to two digits and leaves a wider one alone', () => {
    expect(backupEntryPath({ kind: 'scene', name: 'A', slot: 7, document: {} }))
      .toBe('Scene/07.A.scene');
    expect(backupEntryPath({ kind: 'scene', name: 'A', slot: 50, document: {} }))
      .toBe('Scene/50.A.scene');
  });

  it('omits the slot when none is given', () => {
    expect(backupEntryPath({ kind: 'scene', name: 'A', document: {} })).toBe('Scene/A.scene');
  });

  it('honours an explicit path', () => {
    expect(backupEntryPath({ kind: 'scn', name: 'x', path: 'custom/p.scn', document: {} }))
      .toBe('custom/p.scn');
  });

  it.each([
    ['a scn with no project', { kind: 'scn' as const, name: 'S' }, /needs a project/],
    ['a cnfg with no project', { kind: 'cnfg' as const, name: 'C' }, /needs a project/],
    ['a name with a separator', { kind: 'scene' as const, name: 'a/b' }, /may not contain a separator/],
    ['a project with a separator', { kind: 'scn' as const, name: 'S', project: 'a/b' }, /may not contain a separator/],
    ['an empty name', { kind: 'scene' as const, name: '' }, /name is required/],
    ['slot zero', { kind: 'scene' as const, name: 'A', slot: 0 }, /positive integer/],
    ['a fractional slot', { kind: 'scene' as const, name: 'A', slot: 1.5 }, /positive integer/],
  ])('rejects %s', (_label, entry, pattern) => {
    expect(() => backupEntryPath({ ...entry, document: {} } as never)).toThrow(pattern);
  });
});

describe('buildBackupArchive', () => {
  const entries = () => [
    { kind: 'channel' as const, name: 'Kick 1', slot: 1, category: 'Drum', document: makeChannelPreset() },
    { kind: 'scene' as const, name: 'Zero Out (Board Reset)', slot: 1, document: makeScn(16, 6) },
    { kind: 'scn' as const, name: 'Starting', slot: 1, project: '01.Sunday.proj', document: makeScn(16, 6) },
    { kind: 'cnfg' as const, name: 'Sunday', project: '01.Sunday.proj', document: makeCnfg() },
  ];

  // The property that matters: an archive we write reads back as the same
  // archive. The writer's path building and the reader's path parsing are
  // separate code, and this is what keeps them in agreement.
  it('round-trips through the reader', () => {
    const backup = parseBackupArchive(buildBackupArchive(entries()));
    const summary = summariseBackup(backup);
    expect(summary.counts).toEqual({ scene: 1, scn: 1, cnfg: 1, channel: 1, fx: 0 });
    expect(summary.hasUserContent).toBe(true);
    expect(summary.projects[0]).toMatchObject({
      directory: '01.Sunday.proj', name: 'Sunday', scenes: ['Starting'], hasConfig: true,
    });
  });

  it('round-trips document content exactly', () => {
    const scn = makeScn(4, 2);
    const backup = parseBackupArchive(buildBackupArchive([
      { kind: 'scn', name: 'S', slot: 1, project: '01.P.proj', document: scn },
    ]));
    expect(backup.entries[0].document).toEqual(scn);
  });

  it('round-trips the console shape', () => {
    const backup = parseBackupArchive(buildBackupArchive([
      { kind: 'scn', name: 'S', slot: 1, project: '01.P.proj', document: makeScn(32, 16) },
    ]));
    expect(summariseBackup(backup).channelCounts).toMatchObject({ line: 32, aux: 16 });
  });

  // Pass-through is the default for a document being copied rather than
  // authored: re-serialising changes ~95% of the numeric literals, and a backup
  // should not introduce a difference it does not need.
  it('preserves supplied bytes verbatim', () => {
    const exact = Buffer.from('{\n\t"line": \n\t{\n\t\t"ch1": \n\t\t{\n\t\t\t"volume": -84.000000001\n\t\t}\n\t}\n}');
    const zip = buildBackupArchive([
      { kind: 'scene', name: 'S', slot: 1, content: exact },
    ]);
    const zipEntries = listZipEntries(zip);
    expect(readZipEntry(zip, zipEntries[0]).equals(exact)).toBe(true);
  });

  it('refuses both content and document on one entry', () => {
    expect(() => buildBackupArchive([
      { kind: 'scene', name: 'S', content: Buffer.from('{}'), document: {} },
    ])).toThrow(/exactly one of content or document/);
  });

  it('refuses neither', () => {
    expect(() => buildBackupArchive([{ kind: 'scene', name: 'S' }]))
      .toThrow(/exactly one of content or document/);
  });

  it('refuses a non-Buffer content', () => {
    expect(() => buildBackupArchive([
      { kind: 'scene', name: 'S', content: '{}' as never },
    ])).toThrow(/must be a Buffer/);
  });

  it('refuses an empty archive', () => {
    expect(() => buildBackupArchive([])).toThrow(/at least one document/);
  });

  it('reports unknown float keys from the documents it serialised', () => {
    const unknownFloatKeys = new Set<string>();
    buildBackupArchive(
      [{ kind: 'scene', name: 'S', document: { line: { ch1: { newParam: 0.25 } } } }],
      { unknownFloatKeys },
    );
    expect([...unknownFloatKeys]).toEqual(['newParam']);
  });

  it('wraps a ZIP-level refusal in a backup error', () => {
    expect(() => buildBackupArchive([
      { kind: 'scene', name: 'S', slot: 1, document: {} },
      { kind: 'scene', name: 'S', slot: 1, document: {} },
    ])).toThrow(BackupWriteError);
  });
});

describe('rebuildBackupArchive', () => {
  it('re-emits a read archive so it reads back the same', () => {
    const original = buildBackupArchive([
      { kind: 'scene', name: 'Zero Out (Board Reset)', slot: 1, document: makeScn(16, 6) },
      { kind: 'scn', name: 'Starting', slot: 1, project: '01.Sunday.proj', document: makeScn(16, 6) },
      { kind: 'cnfg', name: 'Sunday', project: '01.Sunday.proj', document: makeCnfg() },
    ]);

    const backup = parseBackupArchive(original);
    const rebuilt = parseBackupArchive(rebuildBackupArchive(backup));

    expect(rebuilt.entries.map((e) => e.path)).toEqual(backup.entries.map((e) => e.path));
    expect(rebuilt.entries.map((e) => e.document)).toEqual(backup.entries.map((e) => e.document));
  });

  it('prefers raw bytes when they are supplied', () => {
    const exact = Buffer.from('{\n\t"volume": -84.000000001\n}');
    const original = buildBackupArchive([
      { kind: 'scene', name: 'S', slot: 1, content: exact },
    ]);
    const backup = parseBackupArchive(original);

    const raw = new Map([[backup.entries[0].path, exact]]);
    const rebuilt = rebuildBackupArchive(backup, raw);

    const [entry] = listZipEntries(rebuilt);
    expect(readZipEntry(rebuilt, entry).equals(exact)).toBe(true);
  });
});

/**
 * Reading a console backup archive.
 *
 * The layout and filename conventions asserted here come from two real
 * backups (a 16R and a 32R). The archives themselves are not committed —
 * they carry channel labels, project names and operator names off working
 * boards — so fixtures are synthesised to the same shape.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseBackupArchive,
  readBackupFile,
  summariseBackup,
  classifyEntry,
  parseDocumentFilename,
  BackupFormatError,
} from '../../src/main/console-backup';
import { buildZip, buildBackupFixture, makeScn, makeCnfg } from '../helpers/zip-builder';

describe('parseDocumentFilename', () => {
  // The console names presets `NN.Title.Category.channel`.
  it.each([
    ['01.Kick 1.Drum.channel', 'Kick 1', 'Drum', 1],
    ['27.Acoustic Strumming.Guit.channel', 'Acoustic Strumming', 'Guit', 27],
    ['50.Speech 2.Vocal.channel', 'Speech 2', 'Vocal', 50],
    ['01.Dry Slap Delay.Mono_Delay.fx', 'Dry Slap Delay', 'Mono_Delay', 1],
  ])('parses %s', (filename, name, category, slot) => {
    expect(parseDocumentFilename(filename)).toEqual({ name, category, slot });
  });

  it('parses a scene with no category', () => {
    expect(parseDocumentFilename('01.Starting.scn'))
      .toEqual({ name: 'Starting', category: '', slot: 1 });
  });

  it('keeps a parenthesised name intact', () => {
    expect(parseDocumentFilename('01.Zero Out (Board Reset).scene'))
      .toEqual({ name: 'Zero Out (Board Reset)', category: '', slot: 1 });
  });

  it('handles a config named after its project', () => {
    expect(parseDocumentFilename('Sunday.cnfg'))
      .toEqual({ name: 'Sunday', category: '', slot: null });
  });

  it('handles a filename with no slot prefix', () => {
    expect(parseDocumentFilename('Starting.scn'))
      .toEqual({ name: 'Starting', category: '', slot: null });
  });
});

describe('classifyEntry', () => {
  it.each([
    ['Fat/01.Kick 1.Drum.channel', 'channel', null],
    ['FX/01.Dry Slap Delay.Mono_Delay.fx', 'fx', null],
    ['Scene/01.Zero Out (Board Reset).scene', 'scene', null],
    ['Project/01.Sunday.proj/01.Starting.scn', 'scn', '01.Sunday.proj'],
    ['Project/01.Sunday.proj/Sunday.cnfg', 'cnfg', '01.Sunday.proj'],
  ])('classifies %s', (entryPath, kind, project) => {
    expect(classifyEntry(entryPath)).toEqual({ kind, project });
  });

  it('is case-insensitive about the extension', () => {
    expect(classifyEntry('Scene/01.X.SCENE')?.kind).toBe('scene');
  });

  it.each([
    ['a directory marker', 'Fat/'],
    ['an extensionless file', 'Fat/README'],
    ['an unrelated extension', 'Fat/notes.txt'],
    ['an empty path', ''],
  ])('ignores %s', (_label, entryPath) => {
    expect(classifyEntry(entryPath)).toBeNull();
  });

  // The kind decides, not the directory, so an archive that nests differently
  // still classifies — but a scene outside a .proj has no project.
  it('reports no project for a scn outside a .proj directory', () => {
    expect(classifyEntry('loose/01.Starting.scn')).toEqual({ kind: 'scn', project: null });
  });
});

describe('parseBackupArchive', () => {
  it('reads every document kind from a realistic archive', () => {
    const backup = parseBackupArchive(buildBackupFixture());
    const kinds = backup.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['channel', 'channel', 'cnfg', 'fx', 'scene', 'scn']);
    expect(backup.failures).toEqual([]);
  });

  it('preserves the parsed document', () => {
    const backup = parseBackupArchive(buildBackupFixture());
    const scn = backup.entries.find((e) => e.kind === 'scn');
    expect((scn?.document.line as Record<string, unknown>).ch1).toMatchObject({
      username: 'Ch. 1',
      volume: -84.0,
    });
  });

  // A backup's job is to carry configuration verbatim. An unrecognised key is
  // precisely the case where dropping it loses something nobody can get back,
  // so round-trip fidelity is asserted rather than assumed.
  it('carries through keys the types do not name', () => {
    const doc = makeScn(1, 1);
    (doc.line as Record<string, Record<string, unknown>>).ch1.somethingNewInFirmware = 42;
    (doc as Record<string, unknown>).unknownRoot = { nested: { deep: 'value' } };

    const backup = parseBackupArchive(buildZip([
      { name: 'Project/01.P.proj/01.S.scn', content: JSON.stringify(doc) },
    ]));

    expect(backup.entries[0].document).toEqual(doc);
  });

  it('records the project directory on project documents', () => {
    const backup = parseBackupArchive(buildBackupFixture());
    const scn = backup.entries.find((e) => e.kind === 'scn');
    expect(scn?.project).toBe('01.Sunday.proj');
    expect(backup.entries.find((e) => e.kind === 'scene')?.project).toBeNull();
  });

  it('strips the slot prefix from entry names', () => {
    const backup = parseBackupArchive(buildBackupFixture());
    expect(backup.entries.find((e) => e.kind === 'scn')?.name).toBe('Starting');
  });

  it('ignores non-document entries rather than failing', () => {
    const backup = parseBackupArchive(buildZip([
      { name: 'Scene/', content: '' },
      { name: 'readme.txt', content: 'hello' },
      { name: 'Scene/01.A.scene', content: JSON.stringify(makeScn(1, 1)) },
    ]));
    expect(backup.entries).toHaveLength(1);
    expect(backup.failures).toEqual([]);
  });

  // One corrupt member must not make the rest unreadable — the reason to open a
  // suspect backup is to find out what is wrong with it.
  it('records a malformed document as a failure and keeps the rest', () => {
    const backup = parseBackupArchive(buildZip([
      { name: 'Scene/01.Good.scene', content: JSON.stringify(makeScn(1, 1)) },
      { name: 'Scene/02.Bad.scene', content: '{ not json' },
    ]));
    expect(backup.entries.map((e) => e.name)).toEqual(['Good']);
    expect(backup.failures).toHaveLength(1);
    expect(backup.failures[0].path).toBe('Scene/02.Bad.scene');
  });

  it('treats a JSON array as a malformed document', () => {
    const backup = parseBackupArchive(buildZip([
      { name: 'Scene/01.Good.scene', content: JSON.stringify(makeScn(1, 1)) },
      { name: 'Scene/02.Array.scene', content: '[1,2,3]' },
    ]));
    expect(backup.failures[0].reason).toMatch(/not a JSON object/);
  });

  it.each([
    ['an empty buffer', Buffer.alloc(0), /empty/],
    ['a non-Buffer', 'nope' as never, /expected a Buffer/],
    ['something that is not a ZIP', Buffer.alloc(512), /not a readable console backup/],
  ])('rejects %s', (_label, input, pattern) => {
    expect(() => parseBackupArchive(input as Buffer)).toThrow(pattern);
  });

  it('rejects an archive with no console documents', () => {
    const zip = buildZip([{ name: 'readme.txt', content: 'hello' }]);
    expect(() => parseBackupArchive(zip)).toThrow(/no console documents/);
  });

  it('reports the parse failures when nothing was readable', () => {
    const zip = buildZip([{ name: 'Scene/01.Bad.scene', content: 'not json' }]);
    expect(() => parseBackupArchive(zip)).toThrow(/no readable documents \(1 failed/);
  });
});

describe('summariseBackup', () => {
  it('counts documents by kind', () => {
    const summary = summariseBackup(parseBackupArchive(buildBackupFixture()));
    expect(summary.counts).toEqual({ scene: 1, scn: 1, cnfg: 1, channel: 2, fx: 1 });
    expect(summary.channelPresets).toBe(2);
    expect(summary.fxPresets).toBe(1);
  });

  it('groups projects with their scenes and notes the config', () => {
    const summary = summariseBackup(parseBackupArchive(buildBackupFixture()));
    expect(summary.projects).toEqual([{
      directory: '01.Sunday.proj',
      name: 'Sunday',
      scenes: ['Starting'],
      hasConfig: true,
    }]);
  });

  // Without the .cnfg there is no `global` anywhere in the archive, so the
  // capture is incomplete even though it looks like it has a scene.
  it('flags a project whose config is missing', () => {
    const summary = summariseBackup(parseBackupArchive(buildZip([
      { name: 'Project/01.Sunday.proj/01.Starting.scn', content: JSON.stringify(makeScn(1, 1)) },
    ])));
    expect(summary.projects[0].hasConfig).toBe(false);
  });

  it('lists standalone scenes separately from project scenes', () => {
    const summary = summariseBackup(parseBackupArchive(buildBackupFixture()));
    expect(summary.standaloneScenes).toEqual(['Zero Out (Board Reset)']);
  });

  it('infers channel counts from the richest document', () => {
    const summary = summariseBackup(
      parseBackupArchive(buildBackupFixture({ lineCount: 32, auxCount: 16 })),
    );
    expect(summary.channelCounts).toMatchObject({ line: 32, aux: 16 });
  });

  // `cnfg` carries fewer channel roots than `scn`, so picking the first
  // document rather than the richest would understate the console.
  it('does not let a sparse config mask a fuller scene', () => {
    const summary = summariseBackup(parseBackupArchive(buildZip([
      { name: 'Project/01.P.proj/P.cnfg', content: JSON.stringify(makeCnfg()) },
      { name: 'Project/01.P.proj/01.S.scn', content: JSON.stringify(makeScn(16, 6)) },
    ])));
    expect(summary.channelCounts).toMatchObject({ line: 16, aux: 6 });
  });

  it('reports null channel counts when no document carries channel roots', () => {
    const summary = summariseBackup(parseBackupArchive(buildZip([
      { name: 'Fat/01.A.Drum.channel', content: '{"filter":{"hpf":24}}' },
    ])));
    expect(summary.channelCounts).toBeNull();
  });

  // The distinction that matters most in practice. Universal Control backs up
  // the console's stored document library, not its live state — so an archive
  // from a board whose operator never saved a scene contains only the factory
  // library. It is a successful backup of nothing anyone wanted.
  describe('hasUserContent', () => {
    it('is true when the archive holds a user project', () => {
      const summary = summariseBackup(parseBackupArchive(buildBackupFixture()));
      expect(summary.hasUserContent).toBe(true);
    });

    it('is false for a factory-library-only archive', () => {
      const summary = summariseBackup(
        parseBackupArchive(buildBackupFixture({ withProject: false })),
      );
      expect(summary.hasUserContent).toBe(false);
      // The factory reset scene is still there, which is why its presence
      // cannot stand in for user content.
      expect(summary.standaloneScenes).toEqual(['Zero Out (Board Reset)']);
      expect(summary.counts.scene).toBe(1);
    });
  });

  it('surfaces parse failures in the summary', () => {
    const backup = parseBackupArchive(buildZip([
      { name: 'Scene/01.Good.scene', content: JSON.stringify(makeScn(1, 1)) },
      { name: 'Scene/02.Bad.scene', content: 'nope' },
    ]));
    expect(summariseBackup(backup).failures).toHaveLength(1);
  });
});

describe('readBackupFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slbak-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads an archive from disk and records its path', () => {
    const file = path.join(dir, 'StudioLive16R_2026-10-06.bak');
    fs.writeFileSync(file, buildBackupFixture());
    const backup = readBackupFile(file);
    expect(backup.source).toBe(path.resolve(file));
    expect(summariseBackup(backup).hasUserContent).toBe(true);
  });

  it('rejects a directory', () => {
    expect(() => readBackupFile(dir)).toThrow(/is not a file/);
  });

  it('propagates a missing file', () => {
    expect(() => readBackupFile(path.join(dir, 'absent.bak'))).toThrow();
  });

  it('rejects an empty file with a format error, not a crash', () => {
    const file = path.join(dir, 'empty.bak');
    fs.writeFileSync(file, Buffer.alloc(0));
    expect(() => readBackupFile(file)).toThrow(BackupFormatError);
  });
});

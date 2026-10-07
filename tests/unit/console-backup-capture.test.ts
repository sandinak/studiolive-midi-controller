/**
 * Capturing a backup from a console.
 *
 * Driven through a fake transport rather than a real connection. That is not
 * only convenience: the alternative is testing against hardware with real shows
 * stored on it, and the enumeration logic is exactly where a mistake would cost
 * someone their console's configuration.
 *
 * The console path shapes, the `* Empty Location *` placeholder and the document
 * sizes all come from a real 16R.
 */

import {
  captureBackup,
  enumerateDocuments,
  archivePathFor,
  transportFromClient,
  type DocumentTransport,
  type ConsoleListEntry,
} from '../../src/main/console-backup-capture';
import { parseBackupArchive, summariseBackup } from '../../src/main/console-backup';
import { encodeUbjson } from '../../src/shared/ubjson';
import { makeScn, makeCnfg, makeChannelPreset } from '../helpers/zip-builder';

/** A console with two projects, a factory scene and a couple of presets. */
function makeTransport(overrides: {
  listings?: Record<string, ConsoleListEntry[]>;
  documents?: Record<string, Buffer>;
  failOn?: string[];
} = {}): DocumentTransport & { listed: string[]; downloaded: string[] } {
  const listings: Record<string, ConsoleListEntry[]> = {
    'presets/channel': [
      { name: '01.Kick 1.Drum.channel', title: 'Kick 1' },
      { name: '02.Snare.Drum.channel', title: 'Snare' },
    ],
    'presets/fx': [{ name: '01.Tape Delay.Mono_Delay.fx', title: 'Tape Delay' }],
    'presets/scene': [{ name: '01.Zero Out (Board Reset).scene', title: 'Zero Out' }],
    'presets/proj': [
      { name: '01.PHS-Choir.proj', title: 'PHS-Choir' },
      { name: '02.Camp Evo.proj', title: 'Camp Evo' },
    ],
    'presets/proj/01.PHS-Choir.proj': [
      { name: 'PHS-Choir.cnfg', title: 'PHS-Choir' },
      { name: '01.Starting.scn', title: 'Starting' },
    ],
    'presets/proj/02.Camp Evo.proj': [
      { name: 'Camp Evo.cnfg', title: 'Camp Evo' },
      { name: '01.New Scene.scn', title: 'New Scene' },
    ],
    ...overrides.listings,
  };

  const listed: string[] = [];
  const downloaded: string[] = [];

  return {
    listed,
    downloaded,
    async list(path) {
      listed.push(path);
      return listings[path] ?? [];
    },
    async download(path) {
      downloaded.push(path);
      if (overrides.failOn?.includes(path)) throw new Error('simulated read failure');
      if (overrides.documents?.[path]) return overrides.documents[path];
      if (path.endsWith('.cnfg')) return encodeUbjson(makeCnfg() as never);
      if (path.endsWith('.channel')) return encodeUbjson(makeChannelPreset() as never);
      if (path.endsWith('.fx')) return encodeUbjson({ plugin: { type: 0 } } as never);
      return encodeUbjson(makeScn(16, 6) as never);
    },
  };
}

describe('archivePathFor', () => {
  // The console's directory names are not the archive's.
  it.each([
    ['presets/channel/01.Kick 1.Drum.channel', 'Fat/01.Kick 1.Drum.channel'],
    ['presets/fx/01.Tape Delay.Mono_Delay.fx', 'FX/01.Tape Delay.Mono_Delay.fx'],
    ['presets/scene/01.Zero Out.scene', 'Scene/01.Zero Out.scene'],
    ['presets/proj/01.Show.proj/01.Starting.scn', 'Project/01.Show.proj/01.Starting.scn'],
    ['presets/proj/01.Show.proj/Show.cnfg', 'Project/01.Show.proj/Show.cnfg'],
  ])('maps %s', (consolePath, expected) => {
    expect(archivePathFor(consolePath)).toBe(expected);
  });

  it('refuses a path it does not recognise rather than guessing', () => {
    expect(() => archivePathFor('presets/mystery/x.dat')).toThrow(/Unrecognised console path/);
  });
});

describe('enumerateDocuments', () => {
  it('finds every document across all sections', async () => {
    const { documents, projects } = await enumerateDocuments(makeTransport());
    expect(documents).toHaveLength(2 + 1 + 1 + 4);
    expect(projects).toEqual(['01.PHS-Choir.proj', '02.Camp Evo.proj']);
  });

  it('descends into each project', async () => {
    const transport = makeTransport();
    await enumerateDocuments(transport);
    expect(transport.listed).toContain('presets/proj/01.PHS-Choir.proj');
    expect(transport.listed).toContain('presets/proj/02.Camp Evo.proj');
  });

  // A project config is the only document carrying `global`. The library's own
  // sendList filters .cnfg out, which is why this module does its own listing.
  it('includes the project config', async () => {
    const { documents } = await enumerateDocuments(makeTransport());
    const cnfg = documents.filter((d) => d.kind === 'cnfg');
    expect(cnfg.map((d) => d.path)).toEqual([
      'presets/proj/01.PHS-Choir.proj/PHS-Choir.cnfg',
      'presets/proj/02.Camp Evo.proj/Camp Evo.cnfg',
    ]);
  });

  it('tags project documents with their project', async () => {
    const { documents } = await enumerateDocuments(makeTransport());
    const scn = documents.find((d) => d.kind === 'scn');
    expect(scn?.project).toBe('01.PHS-Choir.proj');
  });

  // Empty slots are reported with a name but nothing behind them. Fetching them
  // would waste a round trip each on a mostly-empty library.
  it('skips empty slot placeholders', async () => {
    const transport = makeTransport({
      listings: {
        'presets/scene': [
          { name: '01.Real.scene', title: 'Real' },
          { name: '02.scene', title: '* Empty Location *' },
          { name: '03.scene', title: '* Empty Location *' },
        ],
      },
    });
    const { documents } = await enumerateDocuments(transport);
    expect(documents.filter((d) => d.kind === 'scene').map((d) => d.path))
      .toEqual(['presets/scene/01.Real.scene']);
  });

  it('skips lock files', async () => {
    const transport = makeTransport({
      listings: { 'presets/scene': [{ name: 'x.lock' }, { name: '01.Real.scene' }] },
    });
    const { documents } = await enumerateDocuments(transport);
    expect(documents.filter((d) => d.kind === 'scene')).toHaveLength(1);
  });

  it('skips a project member with an unexpected extension', async () => {
    const transport = makeTransport({
      listings: {
        'presets/proj': [{ name: '01.P.proj' }],
        'presets/proj/01.P.proj': [
          { name: '01.S.scn' }, { name: 'P.cnfg' }, { name: 'notes.txt' },
        ],
      },
    });
    const { documents } = await enumerateDocuments(transport);
    const inProject = documents.filter((d) => d.project === '01.P.proj');
    expect(inProject.map((d) => d.kind).sort()).toEqual(['cnfg', 'scn']);
  });

  it('handles a console with an empty library', async () => {
    const transport: DocumentTransport = { async list() { return []; }, async download() { return Buffer.alloc(0); } };
    const { documents, projects } = await enumerateDocuments(transport);
    expect(documents).toEqual([]);
    expect(projects).toEqual([]);
  });
});

describe('captureBackup', () => {
  it('produces an archive the reader understands', async () => {
    const { archive } = await captureBackup(makeTransport());
    const summary = summariseBackup(parseBackupArchive(archive));
    expect(summary.counts).toEqual({ scene: 1, scn: 2, cnfg: 2, channel: 2, fx: 1 });
  });

  it('round-trips the project structure', async () => {
    const { archive } = await captureBackup(makeTransport());
    const summary = summariseBackup(parseBackupArchive(archive));
    expect(summary.projects).toEqual([
      { directory: '01.PHS-Choir.proj', name: 'PHS-Choir', scenes: ['Starting'], hasConfig: true },
      { directory: '02.Camp Evo.proj', name: 'Camp Evo', scenes: ['New Scene'], hasConfig: true },
    ]);
  });

  it('writes documents at their archive paths', async () => {
    const { paths } = await captureBackup(makeTransport());
    expect(paths).toContain('Fat/01.Kick 1.Drum.channel');
    expect(paths).toContain('Project/01.PHS-Choir.proj/PHS-Choir.cnfg');
    expect(paths).toContain('Scene/01.Zero Out (Board Reset).scene');
  });

  it('converts UBJSON to the JSON Universal Control writes', async () => {
    const { archive } = await captureBackup(makeTransport());
    const backup = parseBackupArchive(archive);
    const scn = backup.entries.find((e) => e.kind === 'scn');
    // Parsed back from JSON text in the archive, so the conversion happened.
    expect((scn?.document.line as Record<string, unknown>).ch1).toMatchObject({
      username: 'Ch. 1',
    });
  });

  it('reports progress for every document', async () => {
    const seen: number[] = [];
    let total = 0;
    await captureBackup(makeTransport(), {
      onProgress: (p) => { seen.push(p.done); total = p.total; },
    });
    expect(total).toBe(8);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reports which projects it found', async () => {
    const result = await captureBackup(makeTransport());
    expect(result.projects).toEqual(['01.PHS-Choir.proj', '02.Camp Evo.proj']);
    expect(result.hasUserContent).toBe(true);
  });

  // The distinction that matters: a console with no stored project has only the
  // factory library to back up, and that is not a record of anything.
  it('flags an archive with no user content', async () => {
    const transport = makeTransport({ listings: { 'presets/proj': [] } });
    const result = await captureBackup(transport);
    expect(result.hasUserContent).toBe(false);
    expect(summariseBackup(parseBackupArchive(result.archive)).hasUserContent).toBe(false);
  });

  describe('failure handling', () => {
    // A backup missing one unreadable preset, which says so, beats no backup.
    it('continues past a failed document by default', async () => {
      const transport = makeTransport({ failOn: ['presets/channel/02.Snare.Drum.channel'] });
      const result = await captureBackup(transport);
      expect(result.failures).toEqual([
        { path: 'presets/channel/02.Snare.Drum.channel', reason: 'simulated read failure' },
      ]);
      expect(result.paths).not.toContain('Fat/02.Snare.Drum.channel');
      expect(result.paths).toContain('Fat/01.Kick 1.Drum.channel');
    });

    it('still reports progress for a failed document', async () => {
      const transport = makeTransport({ failOn: ['presets/fx/01.Tape Delay.Mono_Delay.fx'] });
      let total = 0; let done = 0;
      await captureBackup(transport, { onProgress: (p) => { total = p.total; done = p.done; } });
      expect(done).toBe(total);
    });

    it('aborts on the first failure when asked to', async () => {
      const transport = makeTransport({ failOn: ['presets/channel/01.Kick 1.Drum.channel'] });
      await expect(captureBackup(transport, { continueOnError: false }))
        .rejects.toThrow(/Failed on presets\/channel\/01\.Kick 1\.Drum\.channel/);
    });

    it('records a document that does not decode', async () => {
      const transport = makeTransport({
        documents: { 'presets/scene/01.Zero Out (Board Reset).scene': Buffer.from([0xff, 0xff]) },
      });
      const result = await captureBackup(transport);
      expect(result.failures.map((f) => f.path))
        .toEqual(['presets/scene/01.Zero Out (Board Reset).scene']);
    });

    it('refuses to call an archive of nothing a backup', async () => {
      const everything = [
        'presets/channel/01.Kick 1.Drum.channel', 'presets/channel/02.Snare.Drum.channel',
        'presets/fx/01.Tape Delay.Mono_Delay.fx', 'presets/scene/01.Zero Out (Board Reset).scene',
        'presets/proj/01.PHS-Choir.proj/PHS-Choir.cnfg', 'presets/proj/01.PHS-Choir.proj/01.Starting.scn',
        'presets/proj/02.Camp Evo.proj/Camp Evo.cnfg', 'presets/proj/02.Camp Evo.proj/01.New Scene.scn',
      ];
      await expect(captureBackup(makeTransport({ failOn: everything })))
        .rejects.toThrow(/Every document failed/);
    });

    it('refuses when the console reports nothing stored', async () => {
      const transport: DocumentTransport = { async list() { return []; }, async download() { return Buffer.alloc(0); } };
      await expect(captureBackup(transport)).rejects.toThrow(/no stored documents/);
    });
  });

  // Empty is expected. Anything here means a console introduced a parameter the
  // float-key registry does not know, which would be written as an integer.
  it('surfaces unknown float keys', async () => {
    const transport = makeTransport({
      documents: {
        'presets/scene/01.Zero Out (Board Reset).scene':
          encodeUbjson({ line: { ch1: { brandNewParam: 0.25 } } } as never),
      },
    });
    const result = await captureBackup(transport);
    expect(result.unknownFloatKeys).toEqual(['brandNewParam']);
  });

  it('is deterministic for the same input and timestamp', async () => {
    const date = new Date(2026, 9, 7, 12, 0, 0);
    const a = await captureBackup(makeTransport(), { date });
    const b = await captureBackup(makeTransport(), { date });
    expect(a.archive.equals(b.archive)).toBe(true);
  });
});

describe('transportFromClient', () => {
  // sendList filters .cnfg out, so this must use the raw List verb.
  it('uses the raw List verb rather than the filtering helper', async () => {
    const calls: string[] = [];
    const transport = transportFromClient({
      async sendFileRequest(verb, path) {
        calls.push(`${verb} ${path}`);
        return Buffer.from(JSON.stringify({ files: [{ name: 'X.cnfg', title: 'X' }] }));
      },
      async downloadDocument() { return Buffer.alloc(0); },
    });
    expect(await transport.list('presets/proj')).toEqual([{ name: 'X.cnfg', title: 'X' }]);
    expect(calls).toEqual(['List presets/proj']);
  });

  it('treats an empty reply as an empty directory', async () => {
    const transport = transportFromClient({
      async sendFileRequest() { return Buffer.alloc(0); },
      async downloadDocument() { return Buffer.alloc(0); },
    });
    expect(await transport.list('presets/scene')).toEqual([]);
  });

  it('reports a listing that is not JSON', async () => {
    const transport = transportFromClient({
      async sendFileRequest() { return Buffer.from('not json'); },
      async downloadDocument() { return Buffer.alloc(0); },
    });
    await expect(transport.list('presets/proj')).rejects.toThrow(/was not JSON/);
  });

  it('tolerates a reply with no files array', async () => {
    const transport = transportFromClient({
      async sendFileRequest() { return Buffer.from('{"other":1}'); },
      async downloadDocument() { return Buffer.alloc(0); },
    });
    expect(await transport.list('presets/proj')).toEqual([]);
  });

  it('passes a download straight through', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const transport = transportFromClient({
      async sendFileRequest() { return Buffer.alloc(0); },
      async downloadDocument(path) { expect(path).toBe('presets/scene/x.scene'); return bytes; },
    });
    expect(await transport.download('presets/scene/x.scene')).toBe(bytes);
  });
});

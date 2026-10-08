/**
 * Restoring a backup to a console.
 *
 * This is the most destructive operation here, so most of these tests are about
 * what it refuses to do. The guard that matters is `allowOverwrite`: without it,
 * a plan that would replace an existing document is rejected rather than run.
 */

import {
  planRestore,
  executeRestore,
  consolePathFor,
  restoreTransportFromClient,
  type RestoreTransport,
} from '../../src/main/console-backup-restore';
import { parseBackupArchive } from '../../src/main/console-backup';
import { buildBackupArchive } from '../../src/main/console-backup-writer';
import { decodeUbjson } from '../../src/shared/ubjson';
import { makeScn, makeCnfg, makeChannelPreset } from '../helpers/zip-builder';

/** An archive with a project, a standalone scene and some factory presets. */
function makeArchive() {
  return parseBackupArchive(buildBackupArchive([
    { kind: 'scn', name: 'Starting', slot: 1, project: '01.Show.proj', document: makeScn(16, 6) },
    { kind: 'cnfg', name: 'Show', project: '01.Show.proj', document: makeCnfg() },
    { kind: 'scene', name: 'Zero Out', slot: 1, document: makeScn(16, 6) },
    { kind: 'channel', name: 'Kick', slot: 1, category: 'Drum', document: makeChannelPreset() },
    { kind: 'fx', name: 'Delay', slot: 1, category: 'Mono_Delay', document: { plugin: { type: 0 } } },
  ]));
}

function makeTransport(listings: Record<string, { name: string; title?: string }[]> = {}) {
  const uploads: { path: string; bytes: Buffer }[] = [];
  const transport: RestoreTransport & { uploads: typeof uploads } = {
    uploads,
    async list(path) {
      if (path in listings) return listings[path];
      // Default: the project exists, everything inside it is empty.
      if (path === 'presets/proj') return [{ name: '01.Show.proj', title: 'Show' }];
      return [];
    },
    async download() { return Buffer.alloc(0); },
    async upload(path, bytes) { uploads.push({ path, bytes }); return { presetType: 'scn' }; },
  };
  return transport;
}

describe('consolePathFor', () => {
  it.each([
    ['Fat/01.Kick.Drum.channel', 'presets/channel/01.Kick.Drum.channel'],
    ['FX/01.Delay.Mono_Delay.fx', 'presets/fx/01.Delay.Mono_Delay.fx'],
    ['Scene/01.Zero Out.scene', 'presets/scene/01.Zero Out.scene'],
    ['Project/01.Show.proj/01.Starting.scn', 'presets/proj/01.Show.proj/01.Starting.scn'],
    ['Project/01.Show.proj/Show.cnfg', 'presets/proj/01.Show.proj/Show.cnfg'],
  ])('maps %s', (archivePath, expected) => {
    expect(consolePathFor(archivePath)).toBe(expected);
  });

  // The inverse of the capture mapping; a mismatch would write to the wrong slot.
  it('round-trips with the capture mapping', async () => {
    const { archivePathFor } = await import('../../src/main/console-backup-capture');
    for (const consolePath of [
      'presets/channel/01.Kick.Drum.channel',
      'presets/fx/01.Delay.Mono_Delay.fx',
      'presets/scene/01.Zero Out.scene',
      'presets/proj/01.Show.proj/01.Starting.scn',
      'presets/proj/01.Show.proj/Show.cnfg',
    ]) {
      expect(consolePathFor(archivePathFor(consolePath))).toBe(consolePath);
    }
  });

  it.each([
    ['an unknown directory', 'Mystery/x.dat'],
    ['a bare filename', 'x.scene'],
    ['a project with no project directory', 'Project/x.scn'],
    ['unexpected nesting', 'Scene/sub/x.scene'],
  ])('refuses %s rather than guessing', (_label, path) => {
    expect(() => consolePathFor(path)).toThrow();
  });
});

describe('planRestore', () => {
  it('writes nothing while planning', async () => {
    const transport = makeTransport();
    await planRestore(makeArchive(), transport);
    expect(transport.uploads).toEqual([]);
  });

  // Restoring 51 identical factory presets takes most of the transfer time and
  // is almost never what someone restoring a show wants.
  it('skips the factory library by default', async () => {
    const plan = await planRestore(makeArchive(), makeTransport());
    expect(plan.writes.map((w) => w.kind).sort()).toEqual(['cnfg', 'scene', 'scn']);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['factory library', 'factory library']);
  });

  it('includes the factory library when asked', async () => {
    const plan = await planRestore(makeArchive(), makeTransport(), { includeFactoryLibrary: true });
    expect(plan.writes).toHaveLength(5);
    expect(plan.skipped).toEqual([]);
  });

  it('restricts to the requested paths', async () => {
    const plan = await planRestore(makeArchive(), makeTransport(), {
      only: ['Project/01.Show.proj/01.Starting.scn'],
    });
    expect(plan.writes.map((w) => w.consolePath))
      .toEqual(['presets/proj/01.Show.proj/01.Starting.scn']);
  });

  it('encodes documents to UBJSON, not JSON', async () => {
    const plan = await planRestore(makeArchive(), makeTransport());
    const scn = plan.writes.find((w) => w.kind === 'scn');
    // Decodes as UBJSON, which JSON text would not.
    const decoded = decodeUbjson(scn!.ubjson) as Record<string, unknown>;
    expect(Object.keys(decoded)).toContain('line');
  });

  it('reports the total upload size', async () => {
    const plan = await planRestore(makeArchive(), makeTransport());
    expect(plan.totalBytes).toBe(plan.writes.reduce((n, w) => n + w.ubjson.length, 0));
    expect(plan.totalBytes).toBeGreaterThan(0);
  });

  describe('create versus overwrite', () => {
    it('marks a write into an empty slot as a create', async () => {
      const plan = await planRestore(makeArchive(), makeTransport());
      expect(plan.writes.every((w) => w.overwrites)).toBe(false);
    });

    it('marks a write into an occupied slot as an overwrite, with the occupant', async () => {
      const transport = makeTransport({
        'presets/proj': [{ name: '01.Show.proj', title: 'Show' }],
        'presets/proj/01.Show.proj': [{ name: '01.Starting.scn', title: 'Last Sunday' }],
      });
      const plan = await planRestore(makeArchive(), transport);
      const scn = plan.writes.find((w) => w.consolePath.endsWith('01.Starting.scn'));
      expect(scn?.overwrites).toBe(true);
      expect(scn?.existingTitle).toBe('Last Sunday');
    });

    it('does not count an empty-slot placeholder as an occupant', async () => {
      const transport = makeTransport({
        'presets/proj': [{ name: '01.Show.proj', title: 'Show' }],
        'presets/scene': [{ name: '01.Zero Out.scene', title: '* Empty Location *' }],
      });
      const plan = await planRestore(makeArchive(), transport);
      expect(plan.writes.find((w) => w.kind === 'scene')?.overwrites).toBe(false);
    });

    // Claiming a write is a safe create when the check failed is the wrong way
    // to be wrong.
    it('treats an unlistable directory as occupied', async () => {
      const transport = makeTransport();
      transport.list = async (path) => {
        if (path === 'presets/proj') return [{ name: '01.Show.proj', title: 'Show' }];
        throw new Error('listing failed');
      };
      const plan = await planRestore(makeArchive(), transport);
      expect(plan.writes.every((w) => w.overwrites)).toBe(true);
    });
  });

  describe('projects', () => {
    it('reports the projects the archive expects', async () => {
      const plan = await planRestore(makeArchive(), makeTransport());
      expect(plan.projects).toEqual(['01.Show.proj']);
      expect(plan.missingProjects).toEqual([]);
    });

    it('reports a project the console does not have', async () => {
      const plan = await planRestore(makeArchive(), makeTransport({ 'presets/proj': [] }));
      expect(plan.missingProjects).toEqual(['01.Show.proj']);
    });
  });

  it('records an entry it cannot encode rather than dropping it', async () => {
    const backup = parseBackupArchive(buildBackupArchive([
      { kind: 'scene', name: 'Good', slot: 1, document: makeScn(1, 1) },
    ]));
    // A value with no UBJSON representation.
    (backup.entries[0].document as Record<string, unknown>).bad = undefined;
    const plan = await planRestore(backup, makeTransport());
    expect(plan.writes).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/could not encode/);
  });
});

describe('executeRestore', () => {
  it('uploads every planned write', async () => {
    const transport = makeTransport();
    const plan = await planRestore(makeArchive(), transport);
    const result = await executeRestore(plan, transport);
    expect(result.written).toEqual(plan.writes.map((w) => w.consolePath));
    expect(transport.uploads.map((u) => u.path)).toEqual(result.written);
    expect(result.failures).toEqual([]);
  });

  it('uploads the planned bytes unchanged', async () => {
    const transport = makeTransport();
    const plan = await planRestore(makeArchive(), transport);
    await executeRestore(plan, transport);
    for (const [i, write] of plan.writes.entries()) {
      expect(transport.uploads[i].bytes.equals(write.ubjson)).toBe(true);
    }
  });

  it('reports progress', async () => {
    const transport = makeTransport();
    const plan = await planRestore(makeArchive(), transport);
    const seen: number[] = [];
    await executeRestore(plan, transport, { onProgress: (p) => seen.push(p.done) });
    expect(seen).toEqual([1, 2, 3]);
  });

  // The one guard between a restore and somebody's stored show.
  describe('the overwrite guard', () => {
    const occupied = () => makeTransport({
      'presets/proj': [{ name: '01.Show.proj', title: 'Show' }],
      'presets/proj/01.Show.proj': [
        { name: '01.Starting.scn', title: 'Last Sunday' },
        { name: 'Show.cnfg', title: 'Show' },
      ],
    });

    it('refuses a plan with overwrites by default', async () => {
      const transport = occupied();
      const plan = await planRestore(makeArchive(), transport);
      await expect(executeRestore(plan, transport)).rejects.toThrow(/Refusing to overwrite/);
      expect(transport.uploads).toEqual([]);
    });

    it('names what it would have replaced', async () => {
      const transport = occupied();
      const plan = await planRestore(makeArchive(), transport);
      await expect(executeRestore(plan, transport))
        .rejects.toThrow(/presets\/proj\/01\.Show\.proj\/01\.Starting\.scn/);
    });

    it('proceeds when overwriting is explicitly allowed', async () => {
      const transport = occupied();
      const plan = await planRestore(makeArchive(), transport);
      const result = await executeRestore(plan, transport, { allowOverwrite: true });
      expect(result.written.length).toBe(plan.writes.length);
    });

    it('does not need the flag when nothing is occupied', async () => {
      const transport = makeTransport();
      const plan = await planRestore(makeArchive(), transport);
      await expect(executeRestore(plan, transport)).resolves.toBeTruthy();
    });
  });

  // A document cannot be written into a project the console does not have, and
  // creating one is outside what this module knows how to do.
  it('refuses when a project is missing from the console', async () => {
    const transport = makeTransport({ 'presets/proj': [] });
    const plan = await planRestore(makeArchive(), transport);
    await expect(executeRestore(plan, transport, { allowOverwrite: true }))
      .rejects.toThrow(/no project directory for: 01\.Show\.proj/);
    expect(transport.uploads).toEqual([]);
  });

  it('refuses an empty plan', async () => {
    const transport = makeTransport();
    const plan = await planRestore(makeArchive(), transport, { only: [] });
    await expect(executeRestore(plan, transport)).rejects.toThrow(/nothing to write/);
  });

  describe('failures', () => {
    it('continues past one failed upload by default', async () => {
      const transport = makeTransport();
      let n = 0;
      transport.upload = async (path) => {
        if (++n === 2) throw new Error('console said no');
        transport.uploads.push({ path, bytes: Buffer.alloc(0) });
        return {};
      };
      const plan = await planRestore(makeArchive(), transport);
      const result = await executeRestore(plan, transport);
      expect(result.failures).toHaveLength(1);
      expect(result.written).toHaveLength(plan.writes.length - 1);
    });

    it('aborts on the first failure when asked', async () => {
      const transport = makeTransport();
      transport.upload = async () => { throw new Error('console said no'); };
      const plan = await planRestore(makeArchive(), transport);
      await expect(executeRestore(plan, transport, { continueOnError: false }))
        .rejects.toThrow(/Failed writing/);
    });
  });
});

describe('restoreTransportFromClient', () => {
  it('routes upload to the client and leaves read alone', async () => {
    const calls: string[] = [];
    const base = {
      async list() { calls.push('list'); return []; },
      async download() { calls.push('download'); return Buffer.alloc(0); },
    };
    const transport = restoreTransportFromClient(base, {
      async uploadDocument(path) { calls.push(`upload ${path}`); return {}; },
    });
    await transport.list('presets/proj');
    await transport.download('presets/scene/x.scene');
    await transport.upload('presets/scene/x.scene', Buffer.from([1]));
    expect(calls).toEqual(['list', 'download', 'upload presets/scene/x.scene']);
  });
});

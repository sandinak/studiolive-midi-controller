/**
 * The ZIP reader parses a file the user chose, so the hostile cases matter as
 * much as the happy path. Every rejection below is a thing a malformed or
 * malicious archive could otherwise do to the main process: read outside the
 * buffer, allocate without bound, or hand back a name that escapes a directory.
 */

import * as zlib from 'zlib';
import { listZipEntries, readZipEntry, ZipError, LIMITS } from '../../src/main/zip-reader';
import { buildZip } from '../helpers/zip-builder';

describe('listZipEntries', () => {
  it('enumerates entries with their sizes', () => {
    const zip = buildZip([
      { name: 'a.json', content: '{"a":1}' },
      { name: 'dir/b.json', content: '{"b":2}' },
    ]);
    const entries = listZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.json', 'dir/b.json']);
    expect(entries[0].uncompressedSize).toBe(7);
  });

  it('marks directory entries', () => {
    const entries = listZipEntries(buildZip([
      { name: 'dir/', content: '' },
      { name: 'dir/f.json', content: '{}' },
    ]));
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[1].isDirectory).toBe(false);
  });

  it('handles an empty archive', () => {
    expect(listZipEntries(buildZip([]))).toEqual([]);
  });

  it('rejects a non-Buffer', () => {
    expect(() => listZipEntries('nope' as never)).toThrow(ZipError);
  });

  it('rejects a file with no end-of-central-directory record', () => {
    expect(() => listZipEntries(Buffer.alloc(512))).toThrow(/not a ZIP file/);
  });

  it('rejects a file too small to be a ZIP', () => {
    expect(() => listZipEntries(Buffer.from([1, 2, 3]))).toThrow(/too small/);
  });

  // ---- Hostile archives ----
  describe('malformed and hostile archives', () => {
    it('rejects a truncated archive', () => {
      const zip = buildZip([{ name: 'a.json', content: '{"a":1}' }]);
      // Keep the EOCD discoverable but cut the central directory out from
      // under it, which is what a half-written file looks like.
      const eocd = zip.subarray(zip.length - 22);
      expect(() => listZipEntries(Buffer.concat([Buffer.alloc(10), eocd])))
        .toThrow(ZipError);
    });

    it('rejects a central directory pointing past end of file', () => {
      const zip = buildZip([{ name: 'a.json', content: '{}' }]);
      // Overwrite the central-directory offset in the EOCD.
      zip.writeUInt32LE(0xfffffff0 >>> 0, zip.length - 22 + 16);
      expect(() => listZipEntries(zip)).toThrow(ZipError);
    });

    it('rejects a bad central directory signature', () => {
      const zip = buildZip([{ name: 'a.json', content: '{}' }]);
      const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
      zip.writeUInt32LE(0xdeadbeef, centralOffset);
      expect(() => listZipEntries(zip)).toThrow(/bad central directory header/);
    });

    it('rejects a multi-disk archive', () => {
      const zip = buildZip([{ name: 'a.json', content: '{}' }]);
      zip.writeUInt16LE(1, zip.length - 22 + 4);
      expect(() => listZipEntries(zip)).toThrow(/multi-disk/);
    });

    it('rejects ZIP64 archives rather than misreading them', () => {
      const zip = buildZip([{ name: 'a.json', content: '{}' }]);
      zip.writeUInt32LE(0xffffffff, zip.length - 22 + 16);
      expect(() => listZipEntries(zip)).toThrow(/ZIP64/);
    });

    it('rejects an entry declaring an implausible uncompressed size', () => {
      const zip = buildZip([{ name: 'a.json', content: '{}' }]);
      const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
      zip.writeUInt32LE(LIMITS.maxEntrySize + 1, centralOffset + 24);
      expect(() => listZipEntries(zip)).toThrow(/entry too large/);
    });

    // A declared size just under the per-entry cap, repeated, must still trip
    // the whole-archive cap — otherwise many medium entries evade both.
    it('rejects an archive whose entries together exceed the total cap', () => {
      const count = Math.ceil(LIMITS.maxTotalSize / LIMITS.maxEntrySize) + 1;
      const zip = buildZip(
        Array.from({ length: count }, (_, i) => ({ name: `f${i}.json`, content: '{}' })),
      );
      const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
      let off = centralOffset;
      for (let i = 0; i < count; i++) {
        zip.writeUInt32LE(LIMITS.maxEntrySize, off + 24);
        const nameLength = zip.readUInt16LE(off + 28);
        off = off + 46 + nameLength;
      }
      expect(() => listZipEntries(zip)).toThrow(/more than the allowed total/);
    });

    // Nothing here writes files, but a name is the identity callers key off and
    // may later join onto a path, so traversal is refused at the parse boundary.
    it.each([
      ['parent segments', '../../etc/passwd'],
      ['a leading slash', '/etc/passwd'],
      ['a Windows drive', 'C:\\Windows\\System32'],
      ['backslash parent segments', 'dir\\..\\..\\secret'],
      ['a null byte', 'evil\0.json'],
    ])('rejects %s in an entry name', (_label, name) => {
      expect(() => listZipEntries(buildZip([{ name, content: '{}' }]))).toThrow(ZipError);
    });

    it('allows a name that merely contains dots', () => {
      const entries = listZipEntries(buildZip([
        { name: 'Project/01.Sunday.proj/01.Starting.scn', content: '{}' },
      ]));
      expect(entries[0].name).toBe('Project/01.Sunday.proj/01.Starting.scn');
    });
  });
});

describe('readZipEntry', () => {
  it('inflates a deflated entry', () => {
    const payload = JSON.stringify({ line: { ch1: { username: 'Kick' } } });
    const zip = buildZip([{ name: 'a.json', content: payload }]);
    const [entry] = listZipEntries(zip);
    expect(entry.compressionMethod).toBe(8);
    expect(readZipEntry(zip, entry).toString('utf8')).toBe(payload);
  });

  it('returns a stored entry verbatim', () => {
    const zip = buildZip([{ name: 'a.json', content: '{"stored":true}', store: true }]);
    const [entry] = listZipEntries(zip);
    expect(entry.compressionMethod).toBe(0);
    expect(readZipEntry(zip, entry).toString('utf8')).toBe('{"stored":true}');
  });

  it('round-trips a payload larger than one deflate block', () => {
    const payload = JSON.stringify({ pad: 'x'.repeat(200_000) });
    const zip = buildZip([{ name: 'big.json', content: payload }]);
    const [entry] = listZipEntries(zip);
    expect(readZipEntry(zip, entry).toString('utf8')).toBe(payload);
  });

  it('refuses to read a directory entry', () => {
    const zip = buildZip([{ name: 'dir/', content: '' }]);
    const [entry] = listZipEntries(zip);
    expect(() => readZipEntry(zip, entry)).toThrow(/is a directory/);
  });

  it('rejects an unsupported compression method', () => {
    const zip = buildZip([{ name: 'a.json', content: '{}' }]);
    const [entry] = listZipEntries(zip);
    expect(() => readZipEntry(zip, { ...entry, compressionMethod: 99 }))
      .toThrow(/unsupported compression method/);
  });

  it('rejects a bad local header signature', () => {
    const zip = buildZip([{ name: 'a.json', content: '{}' }]);
    const [entry] = listZipEntries(zip);
    zip.writeUInt32LE(0xdeadbeef, entry.localHeaderOffset);
    expect(() => readZipEntry(zip, entry)).toThrow(/bad local header/);
  });

  // The central directory and the stream must agree. A stream that inflates to
  // a different length than declared means the archive is inconsistent, and
  // saying so beats handing back a truncated document for JSON.parse to fail on.
  it('rejects a declared size that disagrees with the inflated length', () => {
    const zip = buildZip([{ name: 'a.json', content: '{"a":1}' }]);
    const [entry] = listZipEntries(zip);
    expect(() => readZipEntry(zip, { ...entry, uncompressedSize: 999 }))
      .toThrow(/size mismatch/);
  });

  it('rejects entry data extending past end of file', () => {
    const zip = buildZip([{ name: 'a.json', content: '{}' }]);
    const [entry] = listZipEntries(zip);
    expect(() => readZipEntry(zip, { ...entry, compressedSize: zip.length + 1 }))
      .toThrow(/past end of file/);
  });

  // zlib is told the output cap, so a stream that expands beyond it is refused
  // during inflation rather than after allocating it.
  it('refuses a decompression bomb', () => {
    const bomb = zlib.deflateRawSync(Buffer.alloc(LIMITS.maxEntrySize + 1024));
    const zip = buildZip([{ name: 'bomb.bin', content: 'placeholder', store: true }]);
    const [entry] = listZipEntries(zip);
    // Point a deflate entry at the bomb payload, declaring a benign size.
    const crafted = Buffer.concat([zip, bomb]);
    expect(() => readZipEntry(crafted, {
      ...entry,
      compressionMethod: 8,
      localHeaderOffset: entry.localHeaderOffset,
      compressedSize: bomb.length,
      uncompressedSize: 1024,
    })).toThrow();
  });
});

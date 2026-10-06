/**
 * Minimal ZIP writer, the counterpart to zip-reader.ts.
 *
 * An archive written here is meant to be opened by Universal Control and by the
 * console, not only by this project, so it is built to the spec rather than to
 * whatever our own reader happens to tolerate. In particular **CRC-32 is
 * computed properly**: our reader ignores it, UC almost certainly does not, and
 * a backup that only we can open would be worse than none.
 *
 * Deliberately narrow, matching the reader: deflate or store, no ZIP64, no
 * encryption, no multi-disk. Entry order is preserved, because a console
 * library is presented in slot order and an archive that reshuffles it would
 * read as corrupt to a human even if it parses.
 */

import * as zlib from 'zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Matches the reader's cap, so we never write something we would refuse. */
export const MAX_ENTRIES = 4096;

export class ZipWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipWriteError';
  }
}

export interface ZipWriteEntry {
  /** Path inside the archive, `/`-separated. */
  name: string;
  content: Buffer | string;
  /** Store rather than deflate. Default is to deflate. */
  store?: boolean;
  /** Modification time. Defaults to now. */
  date?: Date;
}

// ─── CRC-32 ────────────────────────────────────────────────────────────────

/**
 * Standard CRC-32 (IEEE 802.3), the checksum ZIP uses. Table built once on
 * first use rather than at module load, since the writer is not always reached.
 */
let crcTable: Int32Array | null = null;

function getCrcTable(): Int32Array {
  if (crcTable) return crcTable;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  crcTable = table;
  return table;
}

export function crc32(buf: Buffer): number {
  const table = getCrcTable();
  let c = -1; // 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

// ─── DOS date/time ─────────────────────────────────────────────────────────

/**
 * ZIP stores timestamps in the MS-DOS packed format, which starts at 1980 and
 * has two-second resolution. Dates outside its range are clamped rather than
 * wrapped, since a wrapped date reads as a corrupt archive.
 */
export function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time:
      (Math.floor(date.getSeconds() / 2) & 0x1f) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getHours() & 0x1f) << 11),
    date:
      (date.getDate() & 0x1f) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (((year - 1980) & 0x7f) << 9),
  };
}

// ─── Writer ────────────────────────────────────────────────────────────────

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

/**
 * Reject a name we would refuse to read back, so a malformed archive cannot be
 * produced here and then fail confusingly at the other end.
 */
function validateName(name: string): void {
  if (!name) throw new ZipWriteError('entry name is empty');
  if (name.includes('\0')) throw new ZipWriteError('entry name contains a null byte');
  if (name.startsWith('/') || name.startsWith('\\')) {
    throw new ZipWriteError(`entry name is absolute: ${name}`);
  }
  if (/^[a-zA-Z]:/.test(name)) {
    throw new ZipWriteError(`entry name has a drive letter: ${name}`);
  }
  if (name.split(/[/\\]/).some((s) => s === '..')) {
    throw new ZipWriteError(`entry name escapes the archive: ${name}`);
  }
  if (Buffer.byteLength(name, 'utf8') > 0xffff) {
    throw new ZipWriteError('entry name is too long');
  }
}

/** Build a ZIP archive. */
export function buildZip(entries: ZipWriteEntry[]): Buffer {
  if (!Array.isArray(entries)) throw new ZipWriteError('expected an array of entries');
  if (entries.length > MAX_ENTRIES) {
    throw new ZipWriteError(`too many entries (${entries.length}, limit ${MAX_ENTRIES})`);
  }

  const seen = new Set<string>();
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    validateName(entry.name);
    // A duplicate name produces an archive whose two members cannot both be
    // addressed; extractors differ on which wins, so refuse it.
    if (seen.has(entry.name)) {
      throw new ZipWriteError(`duplicate entry name: ${entry.name}`);
    }
    seen.add(entry.name);

    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');

    const isDirectory = entry.name.endsWith('/');
    const store = entry.store === true || isDirectory;
    const data = store ? raw : zlib.deflateRawSync(raw);
    const method = store ? 0 : 8;
    const checksum = crc32(raw);
    const { time, date } = toDosDateTime(entry.date ?? new Date());

    // Bit 11 declares the name is UTF-8. Console document names are ASCII, but
    // a user-chosen scene name need not be, and without the flag an extractor
    // is entitled to read the bytes as CP437.
    const flags = 0x0800;

    const local = Buffer.concat([
      u32(SIG_LOCAL),
      u16(20),
      u16(flags),
      u16(method),
      u16(time),
      u16(date),
      u32(checksum),
      u32(data.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
    ]);

    central.push(Buffer.concat([
      u32(SIG_CENTRAL),
      u16(20), // version made by
      u16(20), // version needed
      u16(flags),
      u16(method),
      u16(time),
      u16(date),
      u32(checksum),
      u32(data.length),
      u32(raw.length),
      u16(name.length),
      u16(0), // extra
      u16(0), // comment
      u16(0), // disk start
      u16(0), // internal attrs
      // External attrs: mark directories so extractors create them as such.
      u32(isDirectory ? 0x10 : 0),
      u32(offset),
      name,
    ]));

    parts.push(local, data);
    offset += local.length + data.length;
  }

  const centralOffset = offset;
  const centralBuffer = Buffer.concat(central);

  if (centralOffset + centralBuffer.length > 0xffffffff) {
    throw new ZipWriteError('archive would exceed the 4 GB ZIP limit');
  }

  return Buffer.concat([
    ...parts,
    centralBuffer,
    Buffer.concat([
      u32(SIG_EOCD),
      u16(0), u16(0),
      u16(entries.length), u16(entries.length),
      u32(centralBuffer.length),
      u32(centralOffset),
      u16(0),
    ]),
  ]);
}

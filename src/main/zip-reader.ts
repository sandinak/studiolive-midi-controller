/**
 * Minimal read-only ZIP reader.
 *
 * A console backup is a ZIP, so reading one needs an unzip. Node ships no ZIP
 * support, and the alternatives are a new runtime dependency (this project
 * already carries nine `overrides` for advisories in its existing tree) or
 * shelling out to `unzip`, which does not exist on Windows. Reading a ZIP is
 * a few hundred lines of well-specified structure parsing on top of
 * `zlib.inflateRawSync`, so it is done here instead.
 *
 * Scope is deliberately narrow: enumerate entries and inflate one. No writing,
 * no ZIP64, no encryption, no multi-disk. Anything outside that is rejected
 * with a reason rather than guessed at.
 *
 * **This parses untrusted input** — a backup file arrives from the user, and a
 * malformed or hostile one must not crash the main process or exhaust memory.
 * Every offset is bounds-checked against the buffer, and both per-entry and
 * whole-archive uncompressed sizes are capped.
 */

import * as zlib from 'zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Marker the spec uses for "the real value is in a ZIP64 record". */
const ZIP64_SENTINEL = 0xffffffff;

const EOCD_MIN_SIZE = 22;
/** The EOCD sits at the end, after a comment of up to 65535 bytes. */
const MAX_EOCD_SEARCH = EOCD_MIN_SIZE + 0xffff;

/**
 * Caps, chosen against the reference backups: a real archive is ~50-60 KB
 * compressed and ~300 KB uncompressed, with its largest member a ~240 KB
 * scene. These leave three orders of magnitude of headroom while still
 * bounding a decompression bomb.
 */
export const LIMITS = {
  maxEntries: 4096,
  maxEntrySize: 64 * 1024 * 1024,
  maxTotalSize: 256 * 1024 * 1024,
} as const;

export interface ZipEntry {
  /** Entry name as stored, e.g. `Project/01.Show.proj/01.Starting.scn`. */
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  /** Offset of this entry's local file header. */
  localHeaderOffset: number;
  /** True when the name ends in `/`, which is how ZIP marks a directory. */
  isDirectory: boolean;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/** Read a u16/u32 only when the whole field is inside the buffer. */
function u16(buf: Buffer, off: number): number {
  if (off < 0 || off + 2 > buf.length) throw new ZipError('truncated archive');
  return buf.readUInt16LE(off);
}

function u32(buf: Buffer, off: number): number {
  if (off < 0 || off + 4 > buf.length) throw new ZipError('truncated archive');
  return buf.readUInt32LE(off);
}

/**
 * Locate the End of Central Directory record by scanning backwards for its
 * signature. Scanning is necessary because the record is followed by a
 * variable-length comment, and a comment may itself contain the signature —
 * so the candidate is validated by checking its declared comment length
 * actually reaches the end of the file.
 */
function findEndOfCentralDirectory(buf: Buffer): number {
  if (buf.length < EOCD_MIN_SIZE) throw new ZipError('file is too small to be a ZIP');
  const earliest = Math.max(0, buf.length - MAX_EOCD_SEARCH);
  for (let off = buf.length - EOCD_MIN_SIZE; off >= earliest; off--) {
    if (buf.readUInt32LE(off) !== SIG_EOCD) continue;
    const commentLength = buf.readUInt16LE(off + 20);
    if (off + EOCD_MIN_SIZE + commentLength === buf.length) return off;
  }
  throw new ZipError('not a ZIP file (no end-of-central-directory record)');
}

/**
 * Reject entry names that would escape a destination directory.
 *
 * Nothing here writes files, but a name is the identity a caller will key off
 * and may later join onto a path, so the check belongs at the parse boundary
 * rather than at each use. Backslashes are treated as separators too, since
 * Windows resolves them.
 */
function isUnsafeName(name: string): boolean {
  if (!name) return true;
  if (name.includes('\0')) return true;
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(name)) return true;
  return name
    .split(/[/\\]/)
    .some((segment) => segment === '..');
}

/**
 * Enumerate the entries in a ZIP, reading the central directory.
 *
 * Sizes come from the central directory rather than the local headers: the
 * local header may carry zeroes when the writer streamed the entry and put the
 * real sizes in a trailing data descriptor.
 */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  if (!Buffer.isBuffer(buf)) throw new ZipError('expected a Buffer');

  const eocd = findEndOfCentralDirectory(buf);
  const diskNumber = u16(buf, eocd + 4);
  const diskWithCentral = u16(buf, eocd + 6);
  if (diskNumber !== 0 || diskWithCentral !== 0) {
    throw new ZipError('multi-disk archives are not supported');
  }

  const totalEntries = u16(buf, eocd + 10);
  const centralSize = u32(buf, eocd + 12);
  const centralOffset = u32(buf, eocd + 16);

  if (centralOffset === ZIP64_SENTINEL || centralSize === ZIP64_SENTINEL ||
      totalEntries === 0xffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }
  if (centralOffset + centralSize > buf.length) {
    throw new ZipError('central directory extends past end of file');
  }
  if (totalEntries > LIMITS.maxEntries) {
    throw new ZipError(`archive has too many entries (${totalEntries})`);
  }

  const entries: ZipEntry[] = [];
  let off = centralOffset;
  const centralEnd = centralOffset + centralSize;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (off + 46 > centralEnd) throw new ZipError('truncated central directory');
    if (u32(buf, off) !== SIG_CENTRAL) {
      throw new ZipError(`bad central directory header at offset ${off}`);
    }

    const compressionMethod = u16(buf, off + 10);
    const compressedSize = u32(buf, off + 20);
    const uncompressedSize = u32(buf, off + 24);
    const nameLength = u16(buf, off + 28);
    const extraLength = u16(buf, off + 30);
    const commentLength = u16(buf, off + 32);
    const localHeaderOffset = u32(buf, off + 42);

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL ||
        localHeaderOffset === ZIP64_SENTINEL) {
      throw new ZipError('ZIP64 entries are not supported');
    }

    const nameStart = off + 46;
    if (nameStart + nameLength > centralEnd) {
      throw new ZipError('truncated entry name in central directory');
    }
    // ZIP names are CP437 unless the UTF-8 flag is set; every name in a console
    // backup is ASCII, where the two agree.
    const name = buf.subarray(nameStart, nameStart + nameLength).toString('utf8');

    if (isUnsafeName(name)) {
      throw new ZipError(`unsafe entry name: ${JSON.stringify(name)}`);
    }
    if (uncompressedSize > LIMITS.maxEntrySize) {
      throw new ZipError(`entry too large: ${name} (${uncompressedSize} bytes)`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > LIMITS.maxTotalSize) {
      throw new ZipError('archive uncompresses to more than the allowed total');
    }
    if (localHeaderOffset + 30 > buf.length) {
      throw new ZipError(`entry ${name} points past end of file`);
    }

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });

    off = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Inflate one entry to a Buffer.
 *
 * The data offset is derived from the local header, whose name and extra
 * lengths can differ from the central directory's, so it must be re-read here
 * rather than assumed.
 */
export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.isDirectory) throw new ZipError(`${entry.name} is a directory`);

  const lho = entry.localHeaderOffset;
  if (u32(buf, lho) !== SIG_LOCAL) {
    throw new ZipError(`bad local header for ${entry.name}`);
  }
  const nameLength = u16(buf, lho + 26);
  const extraLength = u16(buf, lho + 28);
  const dataStart = lho + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) {
    throw new ZipError(`entry data for ${entry.name} extends past end of file`);
  }

  const raw = buf.subarray(dataStart, dataEnd);

  let out: Buffer;
  switch (entry.compressionMethod) {
    case METHOD_STORE:
      out = Buffer.from(raw);
      break;
    case METHOD_DEFLATE:
      // maxOutputLength makes zlib refuse an over-long stream rather than
      // allocating it, so a lying uncompressedSize cannot be used to exhaust
      // memory here.
      out = zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.maxEntrySize });
      break;
    default:
      throw new ZipError(
        `unsupported compression method ${entry.compressionMethod} for ${entry.name}`,
      );
  }

  // A mismatch means the archive is inconsistent; callers would otherwise parse
  // a truncated document and report a confusing JSON error.
  if (out.length !== entry.uncompressedSize) {
    throw new ZipError(
      `size mismatch for ${entry.name}: declared ${entry.uncompressedSize}, got ${out.length}`,
    );
  }

  return out;
}

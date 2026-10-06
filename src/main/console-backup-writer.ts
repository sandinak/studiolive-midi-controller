/**
 * Writing a console backup archive.
 *
 * Produces a `.bak` in the vendor's layout, so Universal Control can restore it
 * and the console can read what comes out the other side. The format was
 * measured from real archives rather than guessed; see
 * docs/config-backup-restore-plan.md §1.4.
 *
 * The central rule here is **pass original bytes through untouched**.
 * Re-serialising a document is numerically lossless but textually not: the
 * console prints the full decimal expansion of each float where JavaScript
 * prints the shortest round-tripping form, so a re-emitted document differs in
 * roughly 95% of its numeric literals. Nothing is known to depend on that, and
 * precisely because nothing is known to, a backup should not introduce the
 * difference for documents it is only copying. An entry supplies either
 * `content` (bytes, preserved exactly) or `document` (serialised through
 * `serialiseConsoleDocument`), never both.
 */

import {
  type BackupEntry,
  type ConsoleBackup,
  type ConsoleDocument,
  type ConsoleDocumentKind,
} from '../shared/console-config';
import { serialiseConsoleDocument } from '../shared/console-json';
import { buildZip, type ZipWriteEntry, ZipWriteError } from './zip-writer';

export class BackupWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupWriteError';
  }
}

/** Extension for each document kind, as the console names them. */
const EXTENSION_BY_KIND: Record<ConsoleDocumentKind, string> = {
  scene: 'scene',
  scn: 'scn',
  cnfg: 'cnfg',
  channel: 'channel',
  fx: 'fx',
};

/**
 * Top-level directory for each kind. `scn` and `cnfg` live inside a project
 * directory instead and are handled separately.
 */
const DIRECTORY_BY_KIND: Record<ConsoleDocumentKind, string | null> = {
  scene: 'Scene',
  channel: 'Fat',
  fx: 'FX',
  scn: null,
  cnfg: null,
};

export interface BackupWriteEntry {
  kind: ConsoleDocumentKind;
  /** Display name, without slot prefix or extension. */
  name: string;
  /** Slot number. The console numbers library entries from 1. */
  slot?: number;
  /** Preset category, the third filename component (`Drum`, `Guit`, …). */
  category?: string;
  /** Project directory, required for `scn` and `cnfg`. */
  project?: string | null;
  /** Explicit archive path. Overrides the derived one when supplied. */
  path?: string;
  /** Original bytes, preserved exactly. Mutually exclusive with `document`. */
  content?: Buffer;
  /** A document to serialise. Mutually exclusive with `content`. */
  document?: ConsoleDocument;
}

/**
 * Build the archive path for an entry.
 *
 * Mirrors `parseDocumentFilename`/`classifyEntry` in console-backup.ts — these
 * must agree, or an archive written here will not read back the same way. The
 * round-trip test is what holds them together.
 */
export function backupEntryPath(entry: BackupWriteEntry): string {
  if (entry.path) return entry.path;

  const extension = EXTENSION_BY_KIND[entry.kind];
  if (!extension) throw new BackupWriteError(`unknown document kind: ${entry.kind}`);

  if (!entry.name) throw new BackupWriteError('entry name is required');
  if (/[/\\]/.test(entry.name)) {
    throw new BackupWriteError(`entry name may not contain a separator: ${entry.name}`);
  }

  const parts: string[] = [];
  if (typeof entry.slot === 'number') {
    if (!Number.isInteger(entry.slot) || entry.slot < 1) {
      throw new BackupWriteError(`slot must be a positive integer: ${entry.slot}`);
    }
    parts.push(String(entry.slot).padStart(2, '0'));
  }
  parts.push(entry.name);
  if (entry.category) parts.push(entry.category);
  const filename = `${parts.join('.')}.${extension}`;

  if (entry.kind === 'scn' || entry.kind === 'cnfg') {
    if (!entry.project) {
      throw new BackupWriteError(`${entry.kind} needs a project directory`);
    }
    if (/[/\\]/.test(entry.project)) {
      throw new BackupWriteError(`project may not contain a separator: ${entry.project}`);
    }
    return `Project/${entry.project}/${filename}`;
  }

  const directory = DIRECTORY_BY_KIND[entry.kind];
  return directory ? `${directory}/${filename}` : filename;
}

export interface BuildBackupOptions {
  /** Timestamp for every entry. Defaults to now. */
  date?: Date;
  /**
   * Collects keys serialised as floats that the registry does not know about,
   * so a console or firmware introducing one is noticed rather than silently
   * written as an integer.
   */
  unknownFloatKeys?: Set<string>;
}

/** Build a `.bak` archive. */
export function buildBackupArchive(
  entries: BackupWriteEntry[],
  options: BuildBackupOptions = {},
): Buffer {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new BackupWriteError('a backup needs at least one document');
  }

  const zipEntries: ZipWriteEntry[] = entries.map((entry) => {
    const hasContent = entry.content !== undefined;
    const hasDocument = entry.document !== undefined;
    if (hasContent === hasDocument) {
      throw new BackupWriteError(
        `${entry.name || entry.path}: supply exactly one of content or document`,
      );
    }

    let content: Buffer | string;
    if (hasContent) {
      if (!Buffer.isBuffer(entry.content)) {
        throw new BackupWriteError(`${entry.name}: content must be a Buffer`);
      }
      content = entry.content;
    } else {
      content = serialiseConsoleDocument(entry.document, {
        unknownFloatKeys: options.unknownFloatKeys,
      });
    }

    return { name: backupEntryPath(entry), content, date: options.date };
  });

  try {
    return buildZip(zipEntries);
  } catch (err) {
    if (err instanceof ZipWriteError) {
      throw new BackupWriteError(`could not build archive: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Re-emit a backup that was read with `parseBackupArchive`.
 *
 * Only useful with `rawBytes` populated — a `BackupEntry` carries the parsed
 * document, and re-serialising it would change the numeric literals. Reading an
 * archive and writing it back is how the round-trip test proves the reader and
 * writer agree about paths and layout.
 */
export function rebuildBackupArchive(
  backup: ConsoleBackup,
  rawBytes?: Map<string, Buffer>,
  options: BuildBackupOptions = {},
): Buffer {
  return buildBackupArchive(
    backup.entries.map((entry: BackupEntry) => {
      const raw = rawBytes?.get(entry.path);
      return raw
        ? { kind: entry.kind, name: entry.name, path: entry.path, content: raw }
        : { kind: entry.kind, name: entry.name, path: entry.path, document: entry.document };
    }),
    options,
  );
}

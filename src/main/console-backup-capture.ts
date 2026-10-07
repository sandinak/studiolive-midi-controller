/**
 * Capturing a backup directly from a console.
 *
 * Enumerates every document the console stores, downloads each one, and writes a
 * Universal Control-compatible `.bak` archive. This exists because UC's own
 * backup cannot be relied on: it will report success and produce a plausible
 * archive while holding no connection to the console at all (observed, with the
 * capture to prove it — see docs/config-backup-restore-plan.md §4 and the
 * `[Unreleased]` changelog).
 *
 * The transport is an interface rather than a `Client`, for two reasons. It makes
 * the orchestration — enumeration, path mapping, progress, failure handling —
 * testable without a console on the network, which matters because the only
 * other way to test it is against hardware with real shows on it. And it keeps
 * the protocol in the protocol library, where the fork already implements
 * `sendFileRequest` and `downloadDocument`.
 *
 * Only the download half of transfer is used here, and download has no size
 * limit. Restoring a scene is still blocked by the console's 4096-byte upload
 * cap (§8.4), so this is deliberately backup-only.
 */

import {
  type ConsoleDocumentKind,
  type ConsoleDocument,
} from '../shared/console-config';
import { decodeUbjson } from '../shared/ubjson';
import { buildBackupArchive, type BackupWriteEntry } from './console-backup-writer';

/** One entry as a console directory listing reports it. */
export interface ConsoleListEntry {
  name: string;
  title?: string;
}

/**
 * What this module needs from a console connection.
 *
 * `list` must be **unfiltered**. The library's `sendList` drops `.cnfg` entries,
 * and a project config is the only document carrying `global` — filtering it out
 * would produce an archive that silently omits sample rate, DCA and pan mode and
 * the scene-filter flags.
 */
export interface DocumentTransport {
  /** Raw directory listing for a console path, e.g. `presets/proj`. */
  list(path: string): Promise<ConsoleListEntry[]>;
  /** Download and decompress a document. Returns UBJSON bytes. */
  download(path: string): Promise<Buffer>;
}

/** Console directory → archive directory, and the document kind in each. */
const SECTIONS: readonly {
  consoleDir: string;
  archiveDir: string;
  kind: ConsoleDocumentKind;
}[] = [
  { consoleDir: 'presets/channel', archiveDir: 'Fat', kind: 'channel' },
  { consoleDir: 'presets/fx', archiveDir: 'FX', kind: 'fx' },
  { consoleDir: 'presets/scene', archiveDir: 'Scene', kind: 'scene' },
];

const PROJECTS_DIR = 'presets/proj';

/**
 * Entries a listing reports that are not documents.
 *
 * `* Empty Location *` is how the console presents an unused slot — it has a
 * name but nothing behind it, and asking for it wastes a round trip per empty
 * slot on a console with a mostly-empty library.
 */
const EMPTY_SLOT_TITLE = '* Empty Location *';

function isDocument(entry: ConsoleListEntry): boolean {
  if (!entry?.name) return false;
  if (entry.title === EMPTY_SLOT_TITLE) return false;
  if (entry.name.endsWith('.lock')) return false;
  return true;
}

export interface CaptureProgress {
  /** Documents downloaded so far. */
  done: number;
  /** Documents to download. Known after enumeration. */
  total: number;
  /** Console path currently being fetched. */
  path: string;
}

export interface CaptureOptions {
  /** Called after each document. */
  onProgress?: (progress: CaptureProgress) => void;
  /**
   * Keep going when a single document fails. Default true: a backup that
   * omits one unreadable preset and says so is worth far more than no backup.
   */
  continueOnError?: boolean;
  /** Timestamp for the archive entries. Defaults to now. */
  date?: Date;
}

export interface CaptureResult {
  /** The `.bak` archive. */
  archive: Buffer;
  /** Archive paths written, in order. */
  paths: string[];
  /** Documents that could not be captured, with the reason. */
  failures: { path: string; reason: string }[];
  /** Project directories found. */
  projects: string[];
  /**
   * True when at least one user project was captured.
   *
   * The same warning `summariseBackup` carries: a console whose operator never
   * stored a project has nothing but the factory library to back up, and an
   * archive of that is not a record of how the board was set up.
   */
  hasUserContent: boolean;
  /**
   * Keys serialised as floats that the registry did not know about. Empty is
   * expected; anything here means a console or firmware introduced a parameter
   * and the float table needs updating.
   */
  unknownFloatKeys: string[];
}

/** Enumerate every document on the console, as console paths. */
export async function enumerateDocuments(
  transport: DocumentTransport,
): Promise<{ documents: { path: string; kind: ConsoleDocumentKind; project?: string }[]; projects: string[] }> {
  const documents: { path: string; kind: ConsoleDocumentKind; project?: string }[] = [];

  for (const section of SECTIONS) {
    const entries = await transport.list(section.consoleDir);
    for (const entry of entries) {
      if (!isDocument(entry)) continue;
      documents.push({ path: `${section.consoleDir}/${entry.name}`, kind: section.kind });
    }
  }

  const projects: string[] = [];
  for (const entry of await transport.list(PROJECTS_DIR)) {
    if (!isDocument(entry)) continue;
    projects.push(entry.name);

    for (const child of await transport.list(`${PROJECTS_DIR}/${entry.name}`)) {
      if (!isDocument(child)) continue;
      // A project holds scenes and exactly one config; the extension decides,
      // not the position, so an unexpected member is skipped rather than
      // misfiled.
      const kind: ConsoleDocumentKind | null =
        child.name.endsWith('.scn') ? 'scn'
          : child.name.endsWith('.cnfg') ? 'cnfg'
            : null;
      if (!kind) continue;
      documents.push({
        path: `${PROJECTS_DIR}/${entry.name}/${child.name}`,
        kind,
        project: entry.name,
      });
    }
  }

  return { documents, projects };
}

/** Map a console path to its place in a backup archive. */
export function archivePathFor(consolePath: string): string {
  for (const section of SECTIONS) {
    if (consolePath.startsWith(`${section.consoleDir}/`)) {
      return `${section.archiveDir}/${consolePath.slice(section.consoleDir.length + 1)}`;
    }
  }
  if (consolePath.startsWith(`${PROJECTS_DIR}/`)) {
    return `Project/${consolePath.slice(PROJECTS_DIR.length + 1)}`;
  }
  throw new Error(`Unrecognised console path: ${consolePath}`);
}

/**
 * Capture a full backup from a console.
 *
 * Documents are converted from the console's UBJSON to the JSON Universal
 * Control writes, so the result opens in UC and in `tools/inspect-backup.js`
 * alike. That conversion is lossless in value and not in text — the console
 * prints more decimal places for a float than JavaScript does — which is why
 * `console-json.ts` exists and why its output was checked against UC's byte for
 * byte.
 */
export async function captureBackup(
  transport: DocumentTransport,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const { onProgress, continueOnError = true, date } = options;

  const { documents, projects } = await enumerateDocuments(transport);
  if (documents.length === 0) {
    throw new Error('The console reported no stored documents');
  }

  const entries: BackupWriteEntry[] = [];
  const failures: { path: string; reason: string }[] = [];
  const unknownFloatKeys = new Set<string>();
  let done = 0;

  for (const doc of documents) {
    try {
      const ubjson = await transport.download(doc.path);
      const parsed = decodeUbjson(ubjson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('document did not decode to an object');
      }
      const archivePath = archivePathFor(doc.path);
      entries.push({
        kind: doc.kind,
        name: archivePath.split('/').pop() as string,
        path: archivePath,
        document: parsed as ConsoleDocument,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ path: doc.path, reason });
      if (!continueOnError) {
        throw new Error(`Failed on ${doc.path}: ${reason}`);
      }
    } finally {
      done++;
      onProgress?.({ done, total: documents.length, path: doc.path });
    }
  }

  if (entries.length === 0) {
    throw new Error(
      `Every document failed to capture (${failures.length} of ${documents.length})`,
    );
  }

  const archive = buildBackupArchive(entries, { date, unknownFloatKeys });

  return {
    archive,
    paths: entries.map((e) => e.path as string),
    failures,
    projects,
    hasUserContent: projects.length > 0,
    unknownFloatKeys: [...unknownFloatKeys],
  };
}

/**
 * Adapt a protocol-library `Client` to `DocumentTransport`.
 *
 * `sendFileRequest('List', …)` is used rather than `sendList`, because that
 * helper filters out `.cnfg` entries and a project config is the only document
 * carrying `global`.
 */
export function transportFromClient(client: {
  sendFileRequest(verb: string, path: string, options?: { timeout?: number }): Promise<Buffer>;
  downloadDocument(path: string, options?: { timeout?: number }): Promise<Buffer>;
}): DocumentTransport {
  return {
    async list(path) {
      const raw = await client.sendFileRequest('List', path);
      if (raw.length === 0) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch (err) {
        throw new Error(`Listing ${path} was not JSON: ${(err as Error).message}`);
      }
      const files = (parsed as { files?: unknown })?.files;
      return Array.isArray(files) ? (files as ConsoleListEntry[]) : [];
    },
    download(path) {
      return client.downloadDocument(path);
    },
  };
}

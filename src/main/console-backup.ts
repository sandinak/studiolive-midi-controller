/**
 * Reading a console backup archive.
 *
 * Classifies the entries of a `.bak` ZIP, parses the JSON documents inside, and
 * summarises what the archive actually contains. Read-only: nothing here talks
 * to a console.
 *
 * This is useful on its own, before any restore exists. Universal Control's
 * backup captures the console's *stored document library* — not its live state
 * — so an archive may be missing the very thing its owner assumed was in it.
 * Being able to open one and see that is the first thing anybody debugging a
 * backup needs.
 *
 * Archive layout, from the reference backups (see
 * docs/config-backup-restore-plan.md §1.4):
 *
 *   Fat/NN.Title.Category.channel          channel presets (processing only)
 *   FX/NN.Title.Type.fx                    FX presets
 *   Scene/NN.Title.scene                   standalone scenes
 *   Project/<name>.proj/NN.Title.scn       scenes within a project
 *   Project/<name>.proj/<name>.cnfg        project config — the only `global`
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  type BackupEntry,
  type ConsoleBackup,
  type ConsoleDocument,
  type ConsoleDocumentKind,
  documentChannelCounts,
} from '../shared/console-config';
import { listZipEntries, readZipEntry, ZipError } from './zip-reader';

/**
 * Cap on the archive file itself. The references are 47 KB and 63 KB; a console
 * library an order of magnitude larger is plausible, four orders is not.
 */
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/** Extension → document kind. */
const KIND_BY_EXTENSION: Record<string, ConsoleDocumentKind> = {
  scene: 'scene',
  scn: 'scn',
  cnfg: 'cnfg',
  channel: 'channel',
  fx: 'fx',
};

/**
 * Derive a display name and category from a console preset filename.
 *
 * The console names presets `NN.Title.Category.channel`, where the leading
 * number is a slot index and the category is second from the end. The same
 * convention is parsed in `MixerManager.getChannelPresets` for live preset
 * lists; the rule is repeated rather than shared because that one works on
 * `FileListItem`s off the wire and this one on archive paths.
 */
export function parseDocumentFilename(filename: string): {
  name: string;
  category: string;
  slot: number | null;
} {
  const parts = filename.split('.');
  // Drop the extension.
  if (parts.length > 1) parts.pop();

  let slot: number | null = null;
  if (parts.length > 1 && /^\d+$/.test(parts[0])) {
    slot = Number(parts.shift());
  }

  // `Title.Category` — a category only exists when something follows the title.
  let category = '';
  if (parts.length > 1) category = parts.pop() as string;

  return { name: parts.join('.') || filename, category, slot };
}

/**
 * Classify an archive entry. Returns null for anything that is not a console
 * document — directory markers, stray files — so callers can ignore them
 * without treating them as failures.
 */
export function classifyEntry(
  entryPath: string,
): { kind: ConsoleDocumentKind; project: string | null } | null {
  const segments = entryPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const filename = segments[segments.length - 1];
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const kind = KIND_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()];
  if (!kind) return null;

  // A project document carries its project directory; everything else is
  // top-level by convention, but the kind is what actually decides, so an
  // archive that nests differently still classifies correctly.
  let project: string | null = null;
  if (kind === 'scn' || kind === 'cnfg') {
    const dir = segments.length >= 2 ? segments[segments.length - 2] : null;
    project = dir && dir.toLowerCase().endsWith('.proj') ? dir : null;
  }

  return { kind, project };
}

/**
 * Parse an already-loaded archive.
 *
 * A document that fails to parse is recorded in `failures` rather than thrown,
 * so one corrupt member does not make the rest of a backup unreadable — which
 * matters when the point of opening it is to find out what went wrong.
 * Structural problems with the ZIP itself still throw.
 */
export function parseBackupArchive(buffer: Buffer, source?: string): ConsoleBackup {
  if (!Buffer.isBuffer(buffer)) throw new BackupFormatError('expected a Buffer');
  if (buffer.length === 0) throw new BackupFormatError('backup file is empty');
  if (buffer.length > MAX_BACKUP_BYTES) {
    throw new BackupFormatError(
      `backup file is too large (${buffer.length} bytes, limit ${MAX_BACKUP_BYTES})`,
    );
  }

  let zipEntries;
  try {
    zipEntries = listZipEntries(buffer);
  } catch (err) {
    if (err instanceof ZipError) {
      throw new BackupFormatError(`not a readable console backup: ${err.message}`);
    }
    throw err;
  }

  const entries: BackupEntry[] = [];
  const failures: { path: string; reason: string }[] = [];

  for (const zipEntry of zipEntries) {
    if (zipEntry.isDirectory) continue;
    const classified = classifyEntry(zipEntry.name);
    if (!classified) continue;

    let document: ConsoleDocument;
    try {
      const bytes = readZipEntry(buffer, zipEntry);
      const parsed = JSON.parse(bytes.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('document is not a JSON object');
      }
      document = parsed as ConsoleDocument;
    } catch (err) {
      failures.push({
        path: zipEntry.name,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const filename = zipEntry.name.split('/').filter(Boolean).pop() as string;
    const { name } = parseDocumentFilename(filename);

    entries.push({
      path: zipEntry.name,
      kind: classified.kind,
      project: classified.project,
      name,
      document,
    });
  }

  if (entries.length === 0) {
    throw new BackupFormatError(
      failures.length > 0
        ? `backup contained no readable documents (${failures.length} failed to parse)`
        : 'backup contained no console documents',
    );
  }

  return { source, entries, failures };
}

/** Read and parse a backup archive from disk. */
export function readBackupFile(filePath: string): ConsoleBackup {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new BackupFormatError(`${filePath} is not a file`);
  if (stat.size > MAX_BACKUP_BYTES) {
    throw new BackupFormatError(
      `backup file is too large (${stat.size} bytes, limit ${MAX_BACKUP_BYTES})`,
    );
  }
  return parseBackupArchive(fs.readFileSync(filePath), path.resolve(filePath));
}

// ─── Summary ───────────────────────────────────────────────────────────────

export interface ProjectSummary {
  /** Project directory name, e.g. `01.PHS-Choir.proj`. */
  directory: string;
  /** Display name with the slot prefix and `.proj` suffix removed. */
  name: string;
  /** Scene names inside the project. */
  scenes: string[];
  /** Whether the project's `.cnfg` is present — without it `global` is missing. */
  hasConfig: boolean;
}

export interface BackupSummary {
  source?: string;
  /** Count of documents by kind. */
  counts: Record<ConsoleDocumentKind, number>;
  projects: ProjectSummary[];
  /** Names of standalone `Scene/*.scene` documents. */
  standaloneScenes: string[];
  channelPresets: number;
  fxPresets: number;
  /**
   * Channel counts inferred from the richest document present, which is the
   * shape of the console that wrote the archive. Null when no document carries
   * channel roots.
   */
  channelCounts: Record<string, number> | null;
  /**
   * True when the archive contains at least one user project — i.e. somebody
   * saved their work before backing up.
   *
   * This is the field worth looking at first. Universal Control backs up stored
   * documents, not live state, so an archive from a console whose operator
   * never stored a scene contains only the factory library: technically a
   * successful backup, and useless for recovering that console's setup.
   */
  hasUserContent: boolean;
  failures: { path: string; reason: string }[];
}

/** Strip a project directory name down to something presentable. */
function projectDisplayName(directory: string): string {
  const withoutSuffix = directory.replace(/\.proj$/i, '');
  return withoutSuffix.replace(/^\d+\./, '') || withoutSuffix;
}

/**
 * Describe what an archive contains.
 *
 * `channelCounts` is taken from whichever document declares the most channel
 * roots — a `.scn` and a `.cnfg` each cover only part of the console, so taking
 * the union across one document kind would understate it.
 */
export function summariseBackup(backup: ConsoleBackup): BackupSummary {
  const counts: Record<ConsoleDocumentKind, number> = {
    scene: 0, scn: 0, cnfg: 0, channel: 0, fx: 0,
  };

  const projects = new Map<string, ProjectSummary>();
  const standaloneScenes: string[] = [];
  let channelCounts: Record<string, number> | null = null;
  let bestRootCount = 0;

  for (const entry of backup.entries) {
    counts[entry.kind]++;

    if (entry.kind === 'scene') standaloneScenes.push(entry.name);

    if (entry.project) {
      let summary = projects.get(entry.project);
      if (!summary) {
        summary = {
          directory: entry.project,
          name: projectDisplayName(entry.project),
          scenes: [],
          hasConfig: false,
        };
        projects.set(entry.project, summary);
      }
      if (entry.kind === 'scn') summary.scenes.push(entry.name);
      if (entry.kind === 'cnfg') summary.hasConfig = true;
    }

    if (entry.kind === 'scene' || entry.kind === 'scn' || entry.kind === 'cnfg') {
      const inferred = documentChannelCounts(entry.document);
      const rootCount = Object.keys(inferred).length;
      if (rootCount > bestRootCount) {
        bestRootCount = rootCount;
        channelCounts = inferred;
      }
    }
  }

  return {
    source: backup.source,
    counts,
    projects: [...projects.values()].sort((a, b) => a.directory.localeCompare(b.directory)),
    standaloneScenes,
    channelPresets: counts.channel,
    fxPresets: counts.fx,
    channelCounts,
    hasUserContent: projects.size > 0,
    failures: backup.failures,
  };
}

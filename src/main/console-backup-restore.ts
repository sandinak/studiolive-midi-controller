/**
 * Restoring a backup archive to a console.
 *
 * This is the most destructive thing in this codebase. Writing a document
 * replaces whatever occupies that slot, and there is no undo beyond having
 * another backup — so the module is built around producing a **plan** first and
 * executing it only when a caller explicitly asks.
 *
 * `planRestore` touches nothing: it reads the archive, lists the console, and
 * says exactly which slots would be created and which overwritten. `executeRestore`
 * requires that plan, so a caller cannot skip straight to writing.
 *
 * Documents are converted back to the console's native UBJSON. A `.bak` holds
 * JSON because Universal Control re-serialises on the way to disk; the console
 * does not speak it.
 */

import {
  type BackupEntry,
  type ConsoleBackup,
  type ConsoleDocumentKind,
} from '../shared/console-config';
import { encodeUbjson, type UbjsonValue } from '../shared/ubjson';
import {
  type ConsoleListEntry,
  type DocumentTransport,
} from './console-backup-capture';

/** What restoring needs beyond reading. */
export interface RestoreTransport extends DocumentTransport {
  /** Upload UBJSON bytes to a console path. Overwrites the slot. */
  upload(path: string, ubjson: Buffer): Promise<unknown>;
}

/** Archive directory → console directory. The inverse of the capture mapping. */
const CONSOLE_DIR: Record<string, string> = {
  Fat: 'presets/channel',
  FX: 'presets/fx',
  Scene: 'presets/scene',
};

/**
 * Factory-library kinds.
 *
 * A console ships with 51 channel presets and 13 FX presets, identical on every
 * unit. Restoring them takes two thirds of the transfer time, overwrites slots
 * with the same bytes they already hold, and is almost never what someone
 * restoring a show wants — so they are skipped unless asked for.
 */
const FACTORY_KINDS: readonly ConsoleDocumentKind[] = ['channel', 'fx'];

/** Map an archive entry path back to its console path. */
export function consolePathFor(archivePath: string): string {
  const segments = archivePath.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`Unrecognised archive path: ${archivePath}`);
  }
  const [top, ...rest] = segments;

  if (top === 'Project') {
    if (rest.length !== 2) {
      throw new Error(`A project document needs a project directory: ${archivePath}`);
    }
    return `presets/proj/${rest[0]}/${rest[1]}`;
  }

  const dir = CONSOLE_DIR[top];
  if (!dir) throw new Error(`Unrecognised archive directory: ${top}`);
  if (rest.length !== 1) {
    throw new Error(`Unexpected nesting under ${top}: ${archivePath}`);
  }
  return `${dir}/${rest[0]}`;
}

export interface PlannedWrite {
  archivePath: string;
  consolePath: string;
  kind: ConsoleDocumentKind;
  /** Bytes that would be written. */
  ubjson: Buffer;
  /** True when the console already has something in that slot. */
  overwrites: boolean;
  /** The occupant's display title, when overwriting. */
  existingTitle?: string;
}

export interface RestorePlan {
  writes: PlannedWrite[];
  /** Entries deliberately not written, with the reason. */
  skipped: { archivePath: string; reason: string }[];
  /** Project directories the archive expects to exist on the console. */
  projects: string[];
  /** Projects in the archive that the console does not currently have. */
  missingProjects: string[];
  /** Total bytes of UBJSON to be uploaded. */
  totalBytes: number;
}

export interface PlanOptions {
  /**
   * Include the factory channel and FX presets. Default false — see
   * `FACTORY_KINDS`.
   */
  includeFactoryLibrary?: boolean;
  /** Restrict to these archive paths. */
  only?: string[];
}

/** True when a console listing entry represents a real document. */
function occupied(entry: ConsoleListEntry): boolean {
  return Boolean(entry?.name) && entry.title !== '* Empty Location *'
    && !entry.name.endsWith('.lock');
}

/**
 * Work out what a restore would do, without doing any of it.
 *
 * Lists every console directory the archive touches so each write can be
 * reported as a create or an overwrite. A directory that cannot be listed is
 * treated as unknown rather than empty — claiming a write is a safe create when
 * we could not check would be the wrong way to be wrong.
 */
export async function planRestore(
  backup: ConsoleBackup,
  transport: RestoreTransport,
  options: PlanOptions = {},
): Promise<RestorePlan> {
  const { includeFactoryLibrary = false, only } = options;

  const writes: PlannedWrite[] = [];
  const skipped: { archivePath: string; reason: string }[] = [];

  // Cache listings: an archive has dozens of entries across a handful of dirs.
  const listings = new Map<string, Map<string, ConsoleListEntry> | null>();
  const listingFor = async (dir: string) => {
    if (!listings.has(dir)) {
      try {
        const entries = await transport.list(dir);
        listings.set(dir, new Map(entries.filter(occupied).map((e) => [e.name, e])));
      } catch {
        listings.set(dir, null); // unknown, not empty
      }
    }
    return listings.get(dir) as Map<string, ConsoleListEntry> | null;
  };

  const consoleProjects = new Set(
    ((await listingFor('presets/proj')) ?? new Map()).keys(),
  );
  const archiveProjects = new Set<string>();

  for (const entry of backup.entries as BackupEntry[]) {
    if (only && !only.includes(entry.path)) continue;

    if (!includeFactoryLibrary && FACTORY_KINDS.includes(entry.kind)) {
      skipped.push({ archivePath: entry.path, reason: 'factory library' });
      continue;
    }

    let consolePath: string;
    try {
      consolePath = consolePathFor(entry.path);
    } catch (err) {
      skipped.push({ archivePath: entry.path, reason: (err as Error).message });
      continue;
    }

    if (entry.project) archiveProjects.add(entry.project);

    let ubjson: Buffer;
    try {
      ubjson = encodeUbjson(entry.document as UbjsonValue);
    } catch (err) {
      skipped.push({
        archivePath: entry.path,
        reason: `could not encode: ${(err as Error).message}`,
      });
      continue;
    }

    const dir = consolePath.slice(0, consolePath.lastIndexOf('/'));
    const name = consolePath.slice(consolePath.lastIndexOf('/') + 1);
    const listing = await listingFor(dir);
    const existing = listing?.get(name);

    writes.push({
      archivePath: entry.path,
      consolePath,
      kind: entry.kind,
      ubjson,
      // Unknown counts as overwriting: the cautious reading.
      overwrites: listing === null ? true : Boolean(existing),
      existingTitle: existing?.title,
    });
  }

  return {
    writes,
    skipped,
    projects: [...archiveProjects].sort(),
    missingProjects: [...archiveProjects].filter((p) => !consoleProjects.has(p)).sort(),
    totalBytes: writes.reduce((n, w) => n + w.ubjson.length, 0),
  };
}

export interface RestoreProgress {
  done: number;
  total: number
  consolePath: string;
}

export interface ExecuteOptions {
  onProgress?: (progress: RestoreProgress) => void;
  /** Keep going when one document fails. Default true. */
  continueOnError?: boolean;
  /**
   * Required acknowledgement that occupied slots will be replaced. Without it a
   * plan containing overwrites is refused.
   *
   * A flag rather than a callback so it has to appear in the caller's source,
   * where a reviewer can see it.
   */
  allowOverwrite?: boolean;
}

export interface RestoreResult {
  written: string[];
  failures: { consolePath: string; reason: string }[];
}

/**
 * Execute a plan.
 *
 * Refuses a plan that would overwrite anything unless `allowOverwrite` is set.
 * That is the only guard between a restore and somebody's stored show, and it is
 * deliberately not inferrable from context.
 */
export async function executeRestore(
  plan: RestorePlan,
  transport: RestoreTransport,
  options: ExecuteOptions = {},
): Promise<RestoreResult> {
  const { onProgress, continueOnError = true, allowOverwrite = false } = options;

  if (plan.writes.length === 0) {
    throw new Error('The plan contains nothing to write');
  }

  const overwrites = plan.writes.filter((w) => w.overwrites);
  if (overwrites.length > 0 && !allowOverwrite) {
    throw new Error(
      `Refusing to overwrite ${overwrites.length} existing document(s) without allowOverwrite: ` +
      overwrites.slice(0, 3).map((w) => w.consolePath).join(', ') +
      (overwrites.length > 3 ? ', …' : ''),
    );
  }

  // A project document cannot be written into a project the console does not
  // have, and creating one is not something this module knows how to do.
  if (plan.missingProjects.length > 0) {
    throw new Error(
      `The console has no project directory for: ${plan.missingProjects.join(', ')}. ` +
      'Create the project on the console first.',
    );
  }

  const written: string[] = [];
  const failures: { consolePath: string; reason: string }[] = [];
  let done = 0;

  for (const write of plan.writes) {
    try {
      await transport.upload(write.consolePath, write.ubjson);
      written.push(write.consolePath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ consolePath: write.consolePath, reason });
      if (!continueOnError) {
        throw new Error(`Failed writing ${write.consolePath}: ${reason}`);
      }
    } finally {
      done++;
      onProgress?.({ done, total: plan.writes.length, consolePath: write.consolePath });
    }
  }

  return { written, failures };
}

/** Add upload to a transport built from a protocol-library client. */
export function restoreTransportFromClient(
  base: DocumentTransport,
  client: { uploadDocument(path: string, ubjson: Buffer, options?: { timeout?: number }): Promise<unknown> },
): RestoreTransport {
  return {
    list: base.list.bind(base),
    download: base.download.bind(base),
    upload: (path, ubjson) => client.uploadDocument(path, ubjson),
  };
}

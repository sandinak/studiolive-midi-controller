/**
 * Validates that every ipcMain.handle() channel in index.ts has a
 * corresponding entry in the preload.ts INVOKE_CHANNELS allowlist.
 *
 * A missing entry causes "Blocked IPC invoke channel: ..." at runtime,
 * which is hard to catch without this test.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../src/main');

function extractHandlerChannels(): string[] {
  const src = fs.readFileSync(path.join(SRC, 'index.ts'), 'utf-8');
  const re = /ipcMain\.handle\(\s*'([^']+)'/g;
  const channels: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.push(m[1]);
  }
  return channels;
}

function extractPreloadChannels(): Set<string> {
  const src = fs.readFileSync(path.join(SRC, 'preload.ts'), 'utf-8');
  const re = /'([^']+)'/g;
  const channels = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.add(m[1]);
  }
  return channels;
}

describe('Preload IPC allowlist', () => {
  const handlers = extractHandlerChannels();
  const allowed = extractPreloadChannels();

  it('has at least one handler registered', () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it.each(handlers)('allows IPC channel "%s"', (channel) => {
    expect(allowed.has(channel)).toBe(true);
  });
});

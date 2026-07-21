/**
 * Behavioural tests for the preload bridge.
 *
 * preload-allowlist.test.ts checks the channel lists by reading the source
 * text; this one actually loads preload.ts against a mocked electron and
 * exercises the guards, which are the renderer's only sandbox boundary.
 */

import { ipcRenderer, shell, exposed } from '../__mocks__/electron';

// Loading the module runs exposeInMainWorld as a side effect.
require('../../src/main/preload');

const api = exposed.electronAPI as {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('preload bridge', () => {
  it('exposes electronAPI on the main world', () => {
    expect(api).toBeDefined();
  });

  it('exposes exactly the three documented members', () => {
    expect(Object.keys(api).sort()).toEqual(['invoke', 'on', 'openExternal']);
  });

  // ---- invoke allowlist ----
  describe('invoke', () => {
    it('forwards an allowlisted channel to ipcRenderer', () => {
      api.invoke('get-mixer-status');
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-mixer-status');
    });

    it('forwards additional arguments', () => {
      api.invoke('toggle-mute', 'LINE', 3);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('toggle-mute', 'LINE', 3);
    });

    it('throws for a channel that is not allowlisted', () => {
      expect(() => api.invoke('rm -rf')).toThrow(/Blocked IPC invoke channel/);
    });

    it('does not reach ipcRenderer when blocked', () => {
      expect(() => api.invoke('not-a-real-channel')).toThrow();
      expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    it.each([
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      'valueOf',
    ])('blocks the Object.prototype key %s', (channel) => {
      // A plain-object allowlist would let these through via the prototype
      // chain; the implementation uses a Set, and this pins that.
      expect(() => api.invoke(channel)).toThrow(/Blocked IPC invoke channel/);
    });

    it('blocks a near-miss of an allowlisted channel', () => {
      expect(() => api.invoke('get-mixer-status ')).toThrow();
      expect(() => api.invoke('GET-MIXER-STATUS')).toThrow();
    });
  });

  // ---- on allowlist ----
  describe('on', () => {
    it('subscribes to an allowlisted push channel', () => {
      api.on('mixer-level', () => {});
      expect(ipcRenderer.on).toHaveBeenCalledWith('mixer-level', expect.any(Function));
    });

    it('throws for a channel that is not allowlisted', () => {
      expect(() => api.on('evil-channel', () => {})).toThrow(/Blocked IPC on channel/);
    });

    it('rejects an invoke channel on the push side', () => {
      // The two allowlists are separate; a request/response channel must not
      // be subscribable as a push event.
      expect(() => api.on('get-mixer-status', () => {})).toThrow(/Blocked IPC on channel/);
    });

    it('strips the IpcRendererEvent before calling the listener', () => {
      const received: unknown[][] = [];
      api.on('mixer-level', (...args) => received.push(args));

      // Invoke the wrapper electron would have registered, with a leading event.
      const wrapped = ipcRenderer.on.mock.calls[0][1] as (...a: any[]) => void;
      wrapped({ sender: 'ipc-event' }, { channel: 'LINE', level: 50 });

      expect(received).toEqual([[{ channel: 'LINE', level: 50 }]]);
    });

    it('returns an unsubscribe function that removes the wrapper', () => {
      const unsubscribe = api.on('mixer-mute', () => {});
      expect(typeof unsubscribe).toBe('function');

      const wrapped = ipcRenderer.on.mock.calls[0][1];
      unsubscribe();
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith('mixer-mute', wrapped);
    });
  });

  // ---- openExternal ----
  describe('openExternal', () => {
    it('delegates to shell.openExternal', () => {
      api.openExternal('https://example.com');
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });
  });
});

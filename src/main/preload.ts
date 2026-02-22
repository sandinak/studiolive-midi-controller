/**
 * Electron preload script — bridges renderer ↔ main via contextBridge.
 * Only the channels listed here are accessible to renderer JavaScript.
 * contextIsolation is enabled so the renderer has no direct Node.js access.
 */

import { contextBridge, ipcRenderer, shell } from 'electron';

/** Whitelisted request/response channels (ipcRenderer.invoke) */
const INVOKE_CHANNELS = new Set([
  'add-mapping',
  'check-for-updates',
  'connect-midi-device',
  'connect-mixer',
  'disconnect-midi-device',
  'discover-mixers',
  'get-autofilter-group-assignments',
  'get-changelog',
  'open-docs',
  'get-autofilter-group-names',
  'get-channel-colors',
  'get-channel-icons',
  'get-channel-input-sources',
  'get-channel-link',
  'get-channel-main-assign',
  'get-channel-mute',
  'get-channel-names',
  'get-channel-solo',
  'get-connected-midi-devices',
  'get-app-version',
  'get-current-preset',
  'get-current-preset-path',
  'get-dca-group-assignments',
  'get-discovered-mixers',
  'get-fader-filter',
  'get-level-visibility',
  'get-mappings',
  'get-midi-device-colors',
  'get-midi-devices',
  'get-midi-status',
  'get-mixer-level',
  'get-mixer-status',
  'get-mute-group-assignments',
  'get-mute-group-names',
  'get-mute-group-state',
  'get-preferred-mixer-ip',
  'load-preset-dialog',
  'remove-mapping',
  'save-preset',
  'save-preset-dialog',
  'save-preset-to-path',
  'set-channel-main-assign',
  'set-fader-filter',
  'set-level-visibility',
  'set-midi-device-color',
  'set-midi-feedback-enabled',
  'set-peak-hold',
  'set-mixer-volume',
  'start-midi-scan',
  'stop-midi-scan',
  'toggle-mute',
  'toggle-mute-group',
  'toggle-solo',
  'update-mapping',
]);

/** Whitelisted push-event channels (ipcRenderer.on) */
const ON_CHANNELS = new Set([
  'connection-restored',
  'discovery-result',
  'midi-activity',
  'midi-device-lost',
  'midi-scan-captured',
  'mixer-activity',
  'mixer-lost',
  'mixer-level',
  'mixer-meter',
  'mixer-mute',
  'mixer-property-change',
  'mixer-solo',
  'mixer-state-ready',
  'preset-loaded',
]);

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Invoke a whitelisted IPC channel and await the response.
   */
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!INVOKE_CHANNELS.has(channel)) {
      throw new Error(`Blocked IPC invoke channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * Subscribe to a whitelisted push-event channel.
   * The IpcRendererEvent is stripped — listener receives only the payload args.
   * Returns an unsubscribe function.
   */
  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    if (!ON_CHANNELS.has(channel)) {
      throw new Error(`Blocked IPC on channel: ${channel}`);
    }
    const wrapped = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /**
   * Open a URL in the system default browser.
   */
  openExternal: (url: string): Promise<void> => shell.openExternal(url),
});

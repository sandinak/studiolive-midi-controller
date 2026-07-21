// Mock for the 'electron' module — just enough of the preload surface for
// contextBridge/ipcRenderer/shell to be exercised outside a real Electron run.

type Listener = (...args: any[]) => void;

/** Captures whatever preload.ts hands to contextBridge.exposeInMainWorld. */
export const exposed: Record<string, any> = {};

export const contextBridge = {
  exposeInMainWorld: jest.fn((key: string, api: any) => {
    exposed[key] = api;
  }),
};

export const ipcRenderer = {
  invoke: jest.fn(async (_channel: string, ..._args: unknown[]) => undefined),
  on: jest.fn((_channel: string, _listener: Listener) => undefined),
  removeListener: jest.fn((_channel: string, _listener: Listener) => undefined),
};

export const shell = {
  openExternal: jest.fn(async (_url: string) => undefined),
  openPath: jest.fn(async (_p: string) => ''),
};

export default { contextBridge, ipcRenderer, shell };

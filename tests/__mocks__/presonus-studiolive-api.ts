// Mock for 'presonus-studiolive-api' and 'presonus-studiolive-api/simple'
// Both subpath imports are handled here via jest moduleNameMapper.

import { EventEmitter } from 'events';

// ---- Shared mock state store ----
export class MockState {
  private store = new Map<string, any>();

  // Normalize paths so '.' and '/' are interchangeable (matches real KVTree behavior)
  private normalizePath(path: string): string {
    return path.includes('/') ? path.replace(/\//g, '.') : path;
  }

  get = jest.fn((path: string) => this.store.get(this.normalizePath(path)) ?? null);
  set = jest.fn((path: string, value: any) => { this.store.set(this.normalizePath(path), value); });

  __set(path: string, value: any) {
    this.store.set(this.normalizePath(path), value);
  }
  __clear() {
    this.store.clear();
  }
}

// ---- Channel switch parameter paths, mirroring the real ChannelSwitch map ----
export const ChannelSwitch = {
  phantom: '48v',
  polarity: 'polarity',
  mono: 'mono',
  gate: 'gate/on',
  compressor: 'comp/on',
  eq: 'eq/eqallon',
  limiter: 'limit/limiteron',
} as const;

const CHANNEL_SWITCH_PATHS: Record<string, string> = ChannelSwitch;

// ---- SimpleClient (imported as SimpleClient from 'presonus-studiolive-api/simple') ----
export class SimpleClient extends EventEmitter {
  state: MockState;

  setChannelVolumeLinear = jest.fn().mockResolvedValue(undefined);
  toggleMute = jest.fn();
  setMute = jest.fn();
  toggleSolo = jest.fn();
  setSolo = jest.fn();
  setPan = jest.fn();
  getParameterRange = jest.fn(() => ({ min: 0, max: 60, def: 0, units: 'gain.0', curve: 'linear' }));
  getPreampGain = jest.fn((selector: any) => {
    const v = this.state.get(`${String(selector.type).toLowerCase()}.ch${selector.channel}.preampgain`);
    return v === null || v === undefined ? null : Number(v) * 60;
  });
  setPreampGain = jest.fn((selector: any, db: number) => {
    const clamped = Math.min(60, Math.max(0, Number(db) || 0));
    this.state.set(
      `${String(selector.type).toLowerCase()}.ch${selector.channel}.preampgain`, clamped / 60
    );
  });
  getChannelPresets = jest.fn().mockResolvedValue([
    { name: '07.Snare 1.Drum.channel', title: 'Snare 1' },
    { name: '18.Male 1.Vocal.channel', title: 'Male 1' },
    { name: 'Malformed.channel', title: 'Malformed' },
  ]);
  recallChannelStrip = jest.fn().mockResolvedValue(undefined);
  // Mirrors the real setSwitch closely enough to test MixerManager against:
  // it normalises the console's boolean/number split on read, and writes back
  // into local state because the console does not echo the sender's change.
  getSwitch = jest.fn((selector: any, name: string) => {
    const value = this.state.get(
      `${String(selector.type).toLowerCase()}.ch${selector.channel}.${CHANNEL_SWITCH_PATHS[name]}`
    );
    if (value === null || value === undefined) return null;
    return typeof value === 'boolean' ? value : Number(value) > 0;
  });
  setSwitch = jest.fn((selector: any, name: string, state: boolean | 'toggle') => {
    const path = `${String(selector.type).toLowerCase()}.ch${selector.channel}.${CHANNEL_SWITCH_PATHS[name]}`;
    const value = state === 'toggle' ? !this.getSwitch(selector, name) : state;
    this.state.set(path, value);
  });
  getLevel = jest.fn().mockReturnValue(null);
  connect = jest.fn().mockResolvedValue(undefined);
  close = jest.fn().mockResolvedValue(undefined);

  // Internal methods used by MixerManager
  _sendPacket = jest.fn();
  meterSubscribe = jest.fn().mockResolvedValue(undefined);

  constructor(_opts?: any) {
    super();
    this.state = new MockState();
    // Make state accessible as (client as any).state
    (this as any).channelCounts = {};
  }
}

// ---- Client (imported as Client from 'presonus-studiolive-api') ----
export class Client extends EventEmitter {
  static discover = jest.fn().mockResolvedValue([]);
}

// ---- Discovery (used by MixerManager.discoverProgressive) ----
export class Discovery extends EventEmitter {
  // Devices to emit during start() — set via __setDevices() in tests
  private static _devices: any[] = [];

  static __setDevices(devices: any[]) {
    Discovery._devices = devices;
  }

  static __reset() {
    Discovery._devices = [];
  }

  start = jest.fn((_timeout?: number) => {
    // Emit queued devices synchronously then resolve
    const devices = Discovery._devices;
    for (const device of devices) {
      this.emit('discover', device);
    }
    return Promise.resolve();
  });
}

// ---- Re-export types so type imports in shared/types.ts resolve ----
export type ChannelSelector = {
  type: string;
  channel: number;
};

export type ChannelSwitchName = keyof typeof ChannelSwitch;

export type DiscoveryType = {
  ip: string;
  model: string;
  name: string;
  serial: string;
  deviceName?: string;
};

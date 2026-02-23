// Mock for 'presonus-studiolive-api' and 'presonus-studiolive-api/simple'
// Both subpath imports are handled here via jest moduleNameMapper.

import { EventEmitter } from 'events';

// ---- Shared mock state store ----
export class MockState {
  private store = new Map<string, any>();

  get = jest.fn((path: string) => this.store.get(path) ?? null);
  set = jest.fn((path: string, value: any) => { this.store.set(path, value); });

  __set(path: string, value: any) {
    this.store.set(path, value);
  }
  __clear() {
    this.store.clear();
  }
}

// ---- SimpleClient (imported as SimpleClient from 'presonus-studiolive-api/simple') ----
export class SimpleClient extends EventEmitter {
  state: MockState;

  setChannelVolumeLinear = jest.fn().mockResolvedValue(undefined);
  toggleMute = jest.fn();
  setMute = jest.fn();
  toggleSolo = jest.fn();
  setSolo = jest.fn();
  setPan = jest.fn();
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

export type DiscoveryType = {
  ip: string;
  model: string;
  name: string;
  serial: string;
  deviceName?: string;
};

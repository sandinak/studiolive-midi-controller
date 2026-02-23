import * as os from 'os';
import { MixerManager } from '../../src/main/mixer-manager';
import { SimpleClient, MockState, Discovery } from '../__mocks__/presonus-studiolive-api';

// After the moduleNameMapper intercepts 'presonus-studiolive-api/simple',
// MixerManager instantiates our SimpleClient mock internally.
// We grab the instance via a spy on the constructor.

describe('MixerManager', () => {
  let manager: MixerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MixerManager();
  });

  afterEach(async () => {
    if (manager.isConnected()) {
      await manager.disconnect();
    }
  });

  // ---- isConnected before connect ----
  it('isConnected returns false before connect()', () => {
    expect(manager.isConnected()).toBe(false);
  });

  // ---- connect ----
  it('connect sets isConnected to true and emits connected', async () => {
    const spy = jest.fn();
    manager.on('connected', spy);
    await manager.connect('10.0.0.1', 'StudioLive 32');
    expect(manager.isConnected()).toBe(true);
    expect(spy).toHaveBeenCalledWith('10.0.0.1');
  });

  it('connect stores mixer IP and model', async () => {
    await manager.connect('10.0.0.1', 'SL32');
    expect(manager.getMixerIp()).toBe('10.0.0.1');
    expect(manager.getMixerModel()).toBe('SL32');
  });

  // ---- disconnect ----
  it('disconnect sets isConnected to false', async () => {
    await manager.connect('10.0.0.1');
    await manager.disconnect();
    expect(manager.isConnected()).toBe(false);
  });

  it('disconnect clears IP and model', async () => {
    await manager.connect('10.0.0.1', 'SL32');
    await manager.disconnect();
    expect(manager.getMixerIp()).toBeNull();
    expect(manager.getMixerModel()).toBeNull();
  });

  // ---- setVolume ----
  it('setVolume calls setChannelVolumeLinear on the client', async () => {
    await manager.connect('10.0.0.1');
    const client = (manager as any).client as SimpleClient;
    manager.setVolume({ type: 'LINE' as any, channel: 1 }, 75);
    // setChannelVolumeLinear is a jest.fn() — it returns a resolved promise
    expect(client.setChannelVolumeLinear).toHaveBeenCalledWith(
      { type: 'LINE', channel: 1 },
      75,
    );
  });

  it('setVolume throws when not connected', () => {
    expect(() => manager.setVolume({ type: 'LINE' as any, channel: 1 }, 75)).toThrow('Not connected');
  });

  // ---- getChannelName ----
  it('getChannelName strips numeric prefix (e.g. "1:Piano" → "Piano")', async () => {
    await manager.connect('10.0.0.1');
    const client = (manager as any).client as SimpleClient;
    client.state.__set('line.ch1.username', '1:Piano');
    const name = manager.getChannelName('line', 1);
    expect(name).toBe('Piano');
  });

  it('getChannelName strips tilde prefix from DCA names', async () => {
    await manager.connect('10.0.0.1');
    const client = (manager as any).client as SimpleClient;
    client.state.__set('filtergroup.ch1.name', '~Drums');
    const name = manager.getChannelName('dca', 1);
    expect(name).toBe('Drums');
  });

  it('getChannelName returns "Ch N" fallback when state is empty', async () => {
    await manager.connect('10.0.0.1');
    expect(manager.getChannelName('line', 5)).toBe('Ch 5');
  });

  // ---- getChannelMute — Buffer value ----
  it('getChannelMute converts a Buffer float to boolean', async () => {
    await manager.connect('10.0.0.1');
    const client = (manager as any).client as SimpleClient;
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatLE(1.0, 0);
    client.state.__set('line.ch1.mute', buf);
    expect(manager.getChannelMute('line', 1)).toBe(true);
  });

  it('getChannelMute returns false for zero Buffer', async () => {
    await manager.connect('10.0.0.1');
    const client = (manager as any).client as SimpleClient;
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatLE(0.0, 0);
    client.state.__set('line.ch1.mute', buf);
    expect(manager.getChannelMute('line', 1)).toBe(false);
  });

  // ---- normalizeDcaLevel (private, tested via DCA poll logic) ----
  it('normalizeDcaLevel converts PV float 0.5 → 50', async () => {
    // Access private method via cast
    const normalize = (manager as any).normalizeDcaLevel.bind(manager);
    expect(normalize(0.5)).toBeCloseTo(50);
  });

  it('normalizeDcaLevel passes through a value already in 0-100 range', async () => {
    const normalize = (manager as any).normalizeDcaLevel.bind(manager);
    expect(normalize(75)).toBe(75);
  });

  it('normalizeDcaLevel clamps values above 100', async () => {
    const normalize = (manager as any).normalizeDcaLevel.bind(manager);
    expect(normalize(120)).toBe(100);
  });

  // ---- getMuteGroupState ----
  it('getMuteGroupState returns false when not connected', () => {
    expect(manager.getMuteGroupState(1)).toBe(false);
  });

  it('getMuteGroupState returns false for out-of-range group number', async () => {
    await manager.connect('10.0.0.1');
    expect(manager.getMuteGroupState(0)).toBe(false);
    expect(manager.getMuteGroupState(9)).toBe(false);
  });

  it('getMuteGroupState reads float state from client', async () => {
    await manager.connect('10.0.0.1');
    const client = (manager as any).client as SimpleClient;
    client.state.__set('mutegroup/mutegroup1', 1.0);
    expect(manager.getMuteGroupState(1)).toBe(true);
  });

  // ---- getAllMuteGroupNames ----
  it('getAllMuteGroupNames returns 8 groups', async () => {
    await manager.connect('10.0.0.1');
    const groups = manager.getAllMuteGroupNames();
    expect(groups).toHaveLength(8);
    expect(groups[0].group).toBe(1);
    expect(groups[7].group).toBe(8);
  });

  // ---- setMuteGroupState ----
  it('setMuteGroupState throws for invalid group numbers', async () => {
    await manager.connect('10.0.0.1');
    expect(() => manager.setMuteGroupState(0, true)).toThrow();
    expect(() => manager.setMuteGroupState(9, true)).toThrow();
  });

  it('setMuteGroupState sends a packet and updates state', async () => {
    await manager.connect('10.0.0.1');
    const client = (manager as any).client as SimpleClient;
    manager.setMuteGroupState(1, true);
    expect(client._sendPacket).toHaveBeenCalled();
    expect(client.state.set).toHaveBeenCalledWith('mutegroup/mutegroup1', 1.0);
  });

  // ---- DCA mapping checker ----
  it('setDcaMappingsChecker stores the callback', () => {
    const fn = jest.fn().mockReturnValue(false);
    manager.setDcaMappingsChecker(fn);
    expect((manager as any).hasDcaMappingsCallback).toBe(fn);
  });

  // ---- discover ----
  it('discover delegates to Client.discover', async () => {
    const { Client } = require('../__mocks__/presonus-studiolive-api');
    Client.discover.mockResolvedValueOnce([{ ip: '10.0.0.1', model: 'SL32', name: 'My Mixer', serial: 'ABC' }]);
    const devices = await MixerManager.discover(1000);
    expect(devices).toHaveLength(1);
    expect(devices[0].ip).toBe('10.0.0.1');
  });

  // ---- discoverProgressive ----
  describe('discoverProgressive', () => {
    beforeEach(() => {
      Discovery.__reset();
    });

    it('returns a device emitted during discovery', async () => {
      const remoteDevice = { ip: '10.0.0.1', name: 'SL32', serial: 'ABC123', port: 47809 };
      Discovery.__setDevices([remoteDevice]);

      const seen: any[] = [];
      const devices = await MixerManager.discoverProgressive(100, (d) => seen.push(d));

      expect(devices).toHaveLength(1);
      expect(devices[0].ip).toBe('10.0.0.1');
      expect(seen).toHaveLength(1);
    });

    it('deduplicates devices with the same serial', async () => {
      const device = { ip: '10.0.0.1', name: 'SL32', serial: 'ABC', port: 47809 };
      // Emit the same device twice (e.g. two broadcast packets)
      Discovery.__setDevices([device, { ...device }]);

      const devices = await MixerManager.discoverProgressive(100, jest.fn());
      expect(devices).toHaveLength(1);
    });

    it('deduplicates devices with the same IP when serial is absent', async () => {
      const d1 = { ip: '10.0.0.5', name: 'SL16', serial: '', port: 47809 };
      const d2 = { ip: '10.0.0.5', name: 'SL16', serial: '', port: 47809 };
      Discovery.__setDevices([d1, d2]);

      const devices = await MixerManager.discoverProgressive(100, jest.fn());
      expect(devices).toHaveLength(1);
    });

    it('filters out packets whose IP matches a local interface', async () => {
      // Find an actual local IPv4 address to use as the device IP
      const localIp = Object.values(os.networkInterfaces())
        .flat()
        .find(i => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';

      Discovery.__setDevices([{ ip: localIp, name: 'Self', serial: 'LOCAL', port: 47809 }]);

      const seen: any[] = [];
      const devices = await MixerManager.discoverProgressive(100, (d) => seen.push(d));

      expect(devices).toHaveLength(0);
      expect(seen).toHaveLength(0);
    });

    it('fires the callback for each unique device', async () => {
      Discovery.__setDevices([
        { ip: '10.0.0.1', name: 'SL32', serial: 'A', port: 47809 },
        { ip: '10.0.0.2', name: 'SL16', serial: 'B', port: 47809 },
      ]);

      const cb = jest.fn();
      await MixerManager.discoverProgressive(100, cb);
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  // ---- Metadata getters ----
  describe('metadata getters', () => {
    it('getMixerDeviceName returns stored device name', async () => {
      await manager.connect('10.0.0.1', 'SL32', 'My Mixer', 'SN123');
      expect(manager.getMixerDeviceName()).toBe('My Mixer');
    });

    it('getMixerSerial returns stored serial number', async () => {
      await manager.connect('10.0.0.1', 'SL32', 'My Mixer', 'SN123');
      expect(manager.getMixerSerial()).toBe('SN123');
    });

    it('getMixerName returns deviceName when available', async () => {
      await manager.connect('10.0.0.1', 'SL32', 'My Mixer');
      expect(manager.getMixerName()).toBe('My Mixer');
    });

    it('getMixerName falls back to model when no deviceName', async () => {
      await manager.connect('10.0.0.1', 'SL32');
      expect(manager.getMixerName()).toBe('SL32');
    });

    it('getMixerDeviceName and getMixerSerial are null after disconnect', async () => {
      await manager.connect('10.0.0.1', 'SL32', 'My Mixer', 'SN123');
      await manager.disconnect();
      expect(manager.getMixerDeviceName()).toBeNull();
      expect(manager.getMixerSerial()).toBeNull();
    });
  });

  // ---- Channel control methods — delegation and guard ----
  describe('channel control methods', () => {
    it('toggleMute calls client.toggleMute', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.toggleMute({ type: 'LINE' as any, channel: 1 });
      expect(client.toggleMute).toHaveBeenCalledWith({ type: 'LINE', channel: 1 });
    });

    it('setMute calls client.setMute', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.setMute({ type: 'LINE' as any, channel: 1 }, true);
      expect(client.setMute).toHaveBeenCalledWith({ type: 'LINE', channel: 1 }, true);
    });

    it('toggleSolo calls client.toggleSolo', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.toggleSolo({ type: 'LINE' as any, channel: 1 });
      expect(client.toggleSolo).toHaveBeenCalledWith({ type: 'LINE', channel: 1 });
    });

    it('setSolo calls client.setSolo', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.setSolo({ type: 'LINE' as any, channel: 1 }, false);
      expect(client.setSolo).toHaveBeenCalledWith({ type: 'LINE', channel: 1 }, false);
    });

    it('setPan calls client.setPan', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.setPan({ type: 'LINE' as any, channel: 1 }, 50);
      expect(client.setPan).toHaveBeenCalledWith({ type: 'LINE', channel: 1 }, 50);
    });

    it('toggleMute throws when not connected', () => {
      expect(() => manager.toggleMute({ type: 'LINE' as any, channel: 1 })).toThrow('Not connected');
    });

    it('setSolo throws when not connected', () => {
      expect(() => manager.setSolo({ type: 'LINE' as any, channel: 1 }, true)).toThrow('Not connected');
    });

    it('setPan throws when not connected', () => {
      expect(() => manager.setPan({ type: 'LINE' as any, channel: 1 }, 0)).toThrow('Not connected');
    });
  });

  // ---- getChannelColor ----
  describe('getChannelColor', () => {
    it('converts a numeric RGB value to a hex string', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.color', 0xff0000);
      expect(manager.getChannelColor('line', 1)).toBe('#ff0000');
    });

    it('zero-pads short hex values correctly', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.color', 0x0000ff);
      expect(manager.getChannelColor('line', 1)).toBe('#0000ff');
    });

    it('returns a string color as-is', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.color', '#00ff00');
      expect(manager.getChannelColor('line', 1)).toBe('#00ff00');
    });

    it('returns null when color state is not set', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getChannelColor('line', 1)).toBeNull();
    });

    it('returns null when not connected', () => {
      expect(manager.getChannelColor('line', 1)).toBeNull();
    });
  });

  // ---- getChannelSolo ----
  describe('getChannelSolo', () => {
    it('returns true for a Buffer with float 1.0', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatLE(1.0, 0);
      client.state.__set('line.ch1.solo', buf);
      expect(manager.getChannelSolo('line', 1)).toBe(true);
    });

    it('returns false for a Buffer with float 0.0', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatLE(0.0, 0);
      client.state.__set('line.ch1.solo', buf);
      expect(manager.getChannelSolo('line', 1)).toBe(false);
    });

    it('returns null when state is not set', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getChannelSolo('line', 1)).toBeNull();
    });

    it('returns null when not connected', () => {
      expect(manager.getChannelSolo('line', 1)).toBeNull();
    });
  });

  // ---- getChannelLink ----
  describe('getChannelLink', () => {
    it('returns false for non-LINE channel types', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getChannelLink('aux', 1)).toBe(false);
      expect(manager.getChannelLink('dca', 1)).toBe(false);
    });

    it('returns true for a linked LINE channel', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatLE(1.0, 0);
      client.state.__set('line.ch1.link', buf);
      expect(manager.getChannelLink('LINE', 1)).toBe(true);
    });

    it('returns false for an unlinked LINE channel', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatLE(0.0, 0);
      client.state.__set('line.ch1.link', buf);
      expect(manager.getChannelLink('LINE', 1)).toBe(false);
    });

    it('returns null when link state is not set', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getChannelLink('LINE', 1)).toBeNull();
    });

    it('returns null when not connected', () => {
      expect(manager.getChannelLink('LINE', 1)).toBeNull();
    });
  });

  // ---- getChannelInputSource ----
  describe('getChannelInputSource', () => {
    it.each([
      [0.0,   0],  // Analog
      [0.1,   0],  // Analog (below 0.2 threshold)
      [0.333, 1],  // Network
      [0.4,   1],  // Network (between 0.2 and 0.5)
      [0.667, 2],  // USB
      [0.7,   2],  // USB (between 0.5 and 0.85)
      [1.0,   3],  // SD Card
      [0.9,   3],  // SD Card (above 0.85)
    ])('maps float %f to discrete source %i', async (floatVal, expected) => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.inputsrc', floatVal);
      expect(manager.getChannelInputSource('line', 1)).toBe(expected);
    });

    it('returns null when state is not set', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getChannelInputSource('line', 1)).toBeNull();
    });

    it('returns null when not connected', () => {
      expect(manager.getChannelInputSource('line', 1)).toBeNull();
    });
  });

  // ---- getMuteGroupAssignments ----
  describe('getMuteGroupAssignments', () => {
    it('parses bit string and returns 1-based LINE channel assignments', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      // Positions 0, 1, 2 set → LINE channels 1, 2, 3
      client.state.__set('mutegroup.mutegroup1mutes', '111000');
      const assignments = manager.getMuteGroupAssignments(1);
      expect(assignments).toEqual([
        { type: 'LINE', channel: 1 },
        { type: 'LINE', channel: 2 },
        { type: 'LINE', channel: 3 },
      ]);
    });

    it('returns empty array when no channels are assigned', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('mutegroup.mutegroup1mutes', '00000000');
      expect(manager.getMuteGroupAssignments(1)).toHaveLength(0);
    });

    it('returns empty array for group number 0 (out of range)', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getMuteGroupAssignments(0)).toHaveLength(0);
    });

    it('returns empty array for group number 9 (out of range)', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getMuteGroupAssignments(9)).toHaveLength(0);
    });

    it('returns empty array when not connected', () => {
      expect(manager.getMuteGroupAssignments(1)).toHaveLength(0);
    });

    it('returns empty array when state has no mutes data', async () => {
      await manager.connect('10.0.0.1');
      // state returns null by default for unset paths
      expect(manager.getMuteGroupAssignments(1)).toHaveLength(0);
    });
  });

  // ---- getMuteGroupName ----
  describe('getMuteGroupName', () => {
    it('returns custom name stored in state', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('mutegroup.mutegroup1username', 'Drums');
      expect(manager.getMuteGroupName(1)).toBe('Drums');
    });

    it('returns default "M1" when state is empty', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getMuteGroupName(1)).toBe('M1');
    });

    it('returns default "M8" for group 8', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getMuteGroupName(8)).toBe('M8');
    });

    it('returns default name for out-of-range group when not connected', () => {
      expect(manager.getMuteGroupName(1)).toBe('M1');
    });
  });

  // ---- toggleMuteGroup ----
  describe('toggleMuteGroup', () => {
    it('toggles an inactive group to active', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('mutegroup/mutegroup1', 0.0);
      manager.toggleMuteGroup(1);
      expect(client.state.set).toHaveBeenLastCalledWith('mutegroup/mutegroup1', 1.0);
    });

    it('toggles an active group to inactive', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('mutegroup/mutegroup1', 1.0);
      manager.toggleMuteGroup(1);
      expect(client.state.set).toHaveBeenLastCalledWith('mutegroup/mutegroup1', 0.0);
    });
  });

  // ---- getChannelName — autofilter type ----
  describe('getChannelName for autofilter type', () => {
    it('reads from autofiltergroup state path', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('autofiltergroup.ch1.name', 'Percussion');
      expect(manager.getChannelName('autofilter', 1)).toBe('Percussion');
    });

    it('returns "Ch N" fallback for autofilter when state is empty', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getChannelName('autofilter', 3)).toBe('Ch 3');
    });
  });

  // ---- meterSubscribe non-fatal error path ----
  it('connect succeeds even if meterSubscribe rejects', async () => {
    // The mock already resolves; override to reject just for this test
    const { SimpleClient: MockClient } = require('../__mocks__/presonus-studiolive-api');
    const originalMock = MockClient.prototype.meterSubscribe;
    MockClient.prototype.meterSubscribe = jest.fn().mockRejectedValue(new Error('meters unavailable'));

    try {
      await expect(manager.connect('10.0.0.1')).resolves.toBeUndefined();
      expect(manager.isConnected()).toBe(true);
    } finally {
      MockClient.prototype.meterSubscribe = originalMock;
    }
  });
});

import { MixerManager } from '../../src/main/mixer-manager';
import { SimpleClient, MockState } from '../__mocks__/presonus-studiolive-api';

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
});

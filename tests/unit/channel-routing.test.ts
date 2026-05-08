import { MixerManager } from '../../src/main/mixer-manager';
import { SimpleClient, MockState } from '../__mocks__/presonus-studiolive-api';

describe('Channel Routing - Input Source', () => {
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

  // ---- getChannelInputSource ----
  describe('getChannelInputSource', () => {
    it('returns null when not connected', () => {
      expect(manager.getChannelInputSource('line', 1)).toBeNull();
    });

    it('returns 0 (Analog) for float value 0.0', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.inputsrc', 0.0);
      expect(manager.getChannelInputSource('line', 1)).toBe(0);
    });

    it('returns 1 (Network) for float value ~0.333', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.inputsrc', 0.333);
      expect(manager.getChannelInputSource('line', 1)).toBe(1);
    });

    it('returns 2 (USB) for float value ~0.667', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.inputsrc', 0.667);
      expect(manager.getChannelInputSource('line', 1)).toBe(2);
    });

    it('returns 3 (SD Card) for float value 1.0', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      client.state.__set('line.ch1.inputsrc', 1.0);
      expect(manager.getChannelInputSource('line', 1)).toBe(3);
    });

    it('returns null when state value is missing', async () => {
      await manager.connect('10.0.0.1');
      expect(manager.getChannelInputSource('line', 99)).toBeNull();
    });
  });

  // ---- setChannelInputSource ----
  describe('setChannelInputSource', () => {
    it('throws when not connected', () => {
      expect(() => manager.setChannelInputSource('line', 1, 0)).toThrow('Not connected');
    });

    it('throws for invalid source number', async () => {
      await manager.connect('10.0.0.1');
      expect(() => manager.setChannelInputSource('line', 1, -1)).toThrow('Invalid input source');
      expect(() => manager.setChannelInputSource('line', 1, 4)).toThrow('Invalid input source');
    });

    it('sends PV packet for Analog (source 0)', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.setChannelInputSource('line', 1, 0);

      expect(client._sendPacket).toHaveBeenCalledTimes(1);
      expect(client._sendPacket).toHaveBeenCalledWith('PV', expect.any(Buffer));

      // Verify the path in the buffer
      const buf = client._sendPacket.mock.calls[0][1] as Buffer;
      expect(buf.toString('utf-8', 0, buf.indexOf(0))).toBe('line.ch1.inputsrc');
    });

    it('sends PV packet for USB (source 2)', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.setChannelInputSource('line', 3, 2);

      const buf = client._sendPacket.mock.calls[0][1] as Buffer;
      expect(buf.toString('utf-8', 0, buf.indexOf(0))).toBe('line.ch3.inputsrc');
    });

    it('updates local state after sending packet', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;
      manager.setChannelInputSource('line', 1, 2);

      expect(client.state.set).toHaveBeenCalledWith('line.ch1.inputsrc', expect.closeTo(0.666667, 4));
    });

    it('sends correct float values for each source', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;

      // Analog = 0.0
      manager.setChannelInputSource('line', 1, 0);
      expect(client.state.set).toHaveBeenLastCalledWith('line.ch1.inputsrc', 0.0);

      // Network = 0.333333
      manager.setChannelInputSource('line', 1, 1);
      expect(client.state.set).toHaveBeenLastCalledWith('line.ch1.inputsrc', expect.closeTo(0.333333, 4));

      // USB = 0.666667
      manager.setChannelInputSource('line', 1, 2);
      expect(client.state.set).toHaveBeenLastCalledWith('line.ch1.inputsrc', expect.closeTo(0.666667, 4));

      // SD Card = 1.0
      manager.setChannelInputSource('line', 1, 3);
      expect(client.state.set).toHaveBeenLastCalledWith('line.ch1.inputsrc', 1.0);
    });

    it('works with different channel types', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;

      manager.setChannelInputSource('fxreturn', 2, 1);
      const buf = client._sendPacket.mock.calls[0][1] as Buffer;
      expect(buf.toString('utf-8', 0, buf.indexOf(0))).toBe('fxreturn.ch2.inputsrc');
    });
  });

  // ---- getAllChannelInputSources ----
  describe('getAllChannelInputSources', () => {
    it('returns array with null sources when not connected', () => {
      const sources = manager.getAllChannelInputSources('line', 4);
      expect(sources).toHaveLength(4);
      sources.forEach(s => expect(s.inputsrc).toBeNull());
    });

    it('returns correct sources for populated state', async () => {
      await manager.connect('10.0.0.1');
      const client = (manager as any).client as SimpleClient;

      client.state.__set('line.ch1.inputsrc', 0.0);    // Analog
      client.state.__set('line.ch2.inputsrc', 0.667);   // USB
      client.state.__set('line.ch3.inputsrc', 0.333);   // Network

      const sources = manager.getAllChannelInputSources('line', 3);
      expect(sources).toEqual([
        { channel: 1, inputsrc: 0 },
        { channel: 2, inputsrc: 2 },
        { channel: 3, inputsrc: 1 },
      ]);
    });
  });

  // ---- Roundtrip: set then get ----
  describe('set/get roundtrip', () => {
    it('getChannelInputSource reflects setChannelInputSource', async () => {
      await manager.connect('10.0.0.1');

      // Set to USB
      manager.setChannelInputSource('line', 5, 2);

      // The mock state.set updates the store, so get should return 2
      // Note: state.set is called with the float, but state.__set would give exact control.
      // Since we called the real setChannelInputSource, state.set was called with 0.666667.
      // However, MockState.set is a jest.fn that calls store.set, so state.get should return it.
      const source = manager.getChannelInputSource('line', 5);
      expect(source).toBe(2);
    });
  });
});

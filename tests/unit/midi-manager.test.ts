import { MidiManager } from '../../src/main/midi-manager';
import * as easymidi from 'easymidi';

// Re-cast to access jest mock helpers
const mockEasymidi = easymidi as any;

describe('MidiManager', () => {
  let manager: MidiManager;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset available devices to defaults
    mockEasymidi.__setMockInputs(['Mock Input 1', 'Mock Input 2']);
    mockEasymidi.__setMockOutputs(['Mock Input 1']);
    manager = new MidiManager();
  });

  afterEach(() => {
    manager.disconnectAll();
  });

  // ---- Device enumeration ----
  it('getAvailableDevices returns the mocked list', () => {
    expect(manager.getAvailableDevices()).toEqual(['Mock Input 1', 'Mock Input 2']);
  });

  it('getAvailableOutputDevices returns the mocked list', () => {
    expect(manager.getAvailableOutputDevices()).toEqual(['Mock Input 1']);
  });

  // ---- Connect ----
  it('connectDevice opens an Input and emits connected', () => {
    const spy = jest.fn();
    manager.on('connected', spy);
    manager.connectDevice('Mock Input 1');
    expect(manager.isDeviceConnected('Mock Input 1')).toBe(true);
    expect(spy).toHaveBeenCalledWith('Mock Input 1');
  });

  it('connectDevice is idempotent (no duplicate connections)', () => {
    manager.connectDevice('Mock Input 1');
    manager.connectDevice('Mock Input 1');
    expect(manager.getConnectedDevices()).toHaveLength(1);
  });

  it('getConnectedDevices returns all connected names', () => {
    manager.connectDevice('Mock Input 1');
    manager.connectDevice('Mock Input 2');
    expect(manager.getConnectedDevices()).toEqual(['Mock Input 1', 'Mock Input 2']);
  });

  // ---- MIDI message forwarding ----
  it('forwards CC messages with 1-based channel', () => {
    const spy = jest.fn();
    manager.on('message', spy);
    manager.connectDevice('Mock Input 1');

    // Simulate incoming CC on the Input EventEmitter
    const input = manager['inputs'].get('Mock Input 1')!;
    input.emit('cc', { channel: 0, controller: 7, value: 100 });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cc',
      channel: 1,   // 0 → 1
      controller: 7,
      value: 100,
      device: 'Mock Input 1',
    }));
  });

  it('forwards note_on messages with 1-based channel', () => {
    const spy = jest.fn();
    manager.on('message', spy);
    manager.connectDevice('Mock Input 1');

    const input = manager['inputs'].get('Mock Input 1')!;
    input.emit('noteon', { channel: 1, note: 60, velocity: 127 });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'note_on',
      channel: 2,   // 1 → 2
      note: 60,
      value: 127,
    }));
  });

  it('forwards note_off messages', () => {
    const spy = jest.fn();
    manager.on('message', spy);
    manager.connectDevice('Mock Input 1');

    const input = manager['inputs'].get('Mock Input 1')!;
    input.emit('noteoff', { channel: 0, note: 60, velocity: 0 });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'note_off', note: 60 }));
  });

  it('forwards pitch_bend messages', () => {
    const spy = jest.fn();
    manager.on('message', spy);
    manager.connectDevice('Mock Input 1');

    const input = manager['inputs'].get('Mock Input 1')!;
    input.emit('pitch', { channel: 0, value: 8192 });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'pitch_bend', value: 8192 }));
  });

  // ---- Disconnect ----
  it('disconnectDevice removes the device', () => {
    manager.connectDevice('Mock Input 1');
    manager.disconnectDevice('Mock Input 1');
    expect(manager.isDeviceConnected('Mock Input 1')).toBe(false);
  });

  it('disconnectAll removes all devices', () => {
    manager.connectDevice('Mock Input 1');
    manager.connectDevice('Mock Input 2');
    manager.disconnectAll();
    expect(manager.getConnectedDevices()).toHaveLength(0);
  });

  // ---- Stale device eviction ----
  it('isConnected evicts a device that is no longer available', () => {
    manager.connectDevice('Mock Input 1');
    // Pretend the device disappeared
    mockEasymidi.__setMockInputs(['Mock Input 2']);
    const still = manager.isConnected('Mock Input 1');
    expect(still).toBe(false);
    expect(manager.getConnectedDevices()).not.toContain('Mock Input 1');
  });

  // ---- MIDI output ----
  it('sendCC calls output.send with correct params', () => {
    manager.connectDevice('Mock Input 1');
    const output = manager['outputs'].get('Mock Input 1')!;
    manager.sendCC(1, 7, 100);
    expect(output.send).toHaveBeenCalledWith('cc', { channel: 0, controller: 7, value: 100 });
  });

  it('sendNoteOn calls output.send with correct params', () => {
    manager.connectDevice('Mock Input 1');
    const output = manager['outputs'].get('Mock Input 1')!;
    manager.sendNoteOn(1, 60, 127);
    expect(output.send).toHaveBeenCalledWith('noteon', { channel: 0, note: 60, velocity: 127 });
  });

  it('sendNoteOff calls output.send with velocity 0', () => {
    manager.connectDevice('Mock Input 1');
    const output = manager['outputs'].get('Mock Input 1')!;
    manager.sendNoteOff(1, 60);
    expect(output.send).toHaveBeenCalledWith('noteoff', { channel: 0, note: 60, velocity: 0 });
  });

  it('hasOutput returns true when an output is connected', () => {
    manager.connectDevice('Mock Input 1');
    expect(manager.hasOutput()).toBe(true);
  });

  it('hasOutput returns false before any connection', () => {
    expect(manager.hasOutput()).toBe(false);
  });

  // ---- scanAllInputs ----
  describe('scanAllInputs', () => {
    it('reuses the existing Input instance for an already-connected port', () => {
      manager.connectDevice('Mock Input 1');
      const existingInput = manager['inputs'].get('Mock Input 1')!;
      const addListenerSpy = jest.spyOn(existingInput, 'on');

      const cleanup = manager.scanAllInputs(jest.fn());
      // 'on' should have been called on the existing instance (3 events per port: cc, noteon, pitch)
      expect(addListenerSpy).toHaveBeenCalledTimes(3);
      cleanup();
    });

    it('does not permanently connect unconnected ports (scan-only)', () => {
      // Neither port is pre-connected; scan opens temporary Inputs
      const cleanup = manager.scanAllInputs(jest.fn());
      // manager.inputs should still be empty — scan-only ports are not permanently added
      expect(manager.getConnectedDevices()).toHaveLength(0);
      cleanup();
      // Still empty after cleanup
      expect(manager.getConnectedDevices()).toHaveLength(0);
    });

    it('fires the callback when a connected input emits cc during scan', () => {
      manager.connectDevice('Mock Input 1');
      const cb = jest.fn();
      const cleanup = manager.scanAllInputs(cb);

      const existingInput = manager['inputs'].get('Mock Input 1')!;
      existingInput.emit('cc', { channel: 0, controller: 1, value: 64 });

      expect(cb).toHaveBeenCalledWith('Mock Input 1', expect.objectContaining({ type: 'cc' }));
      cleanup();
    });

    it('cleanup removes temp scan listeners without affecting normal message forwarding', () => {
      manager.connectDevice('Mock Input 1');
      const existingInput = manager['inputs'].get('Mock Input 1')!;

      const cb = jest.fn();
      const cleanup = manager.scanAllInputs(cb);
      cleanup();

      // After cleanup, the main 'message' forwarding listener should still work
      const msgSpy = jest.fn();
      manager.on('message', msgSpy);
      existingInput.emit('cc', { channel: 0, controller: 7, value: 100 });
      expect(msgSpy).toHaveBeenCalled();

      // The scan callback should NOT fire after cleanup
      const callsBefore = cb.mock.calls.length;
      existingInput.emit('cc', { channel: 0, controller: 7, value: 100 });
      expect(cb.mock.calls.length).toBe(callsBefore);
    });
  });
});

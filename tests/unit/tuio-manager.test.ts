import { TuioManager, TuioCursor } from '../../src/main/tuio-manager';

// ---------------------------------------------------------------------------
// Minimal OSC encoders — mirror what a TUIO sender (TouchOSC, Lemur) puts on
// the wire, so the parser is exercised against real packet layouts rather
// than hand-tweaked buffers.
// ---------------------------------------------------------------------------

/** OSC strings are null-terminated then zero-padded to a 4-byte boundary. */
function oscString(s: string): Buffer {
  const len = Math.ceil((s.length + 1) / 4) * 4;
  const buf = Buffer.alloc(len);
  buf.write(s, 0, 'ascii');
  return buf;
}

function oscInt(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function oscFloat(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeFloatBE(n, 0);
  return b;
}

/** Build a `/tuio/2Dcur set <id> <x> <y> <xVel> <yVel>` message. */
function setMessage(id: number, x: number, y: number, xVel = 0, yVel = 0): Buffer {
  return Buffer.concat([
    oscString('/tuio/2Dcur'),
    oscString(',siffff'),
    oscString('set'),
    oscInt(id),
    oscFloat(x), oscFloat(y), oscFloat(xVel), oscFloat(yVel),
  ]);
}

/** Build a `/tuio/2Dcur alive <id...>` message. */
function aliveMessage(ids: number[]): Buffer {
  return Buffer.concat([
    oscString('/tuio/2Dcur'),
    oscString(',s' + 'i'.repeat(ids.length)),
    oscString('alive'),
    ...ids.map(oscInt),
  ]);
}

/** Wrap messages in an OSC bundle: "#bundle\0" + timetag + size-prefixed elements. */
function bundle(...messages: Buffer[]): Buffer {
  const header = Buffer.concat([oscString('#bundle'), Buffer.alloc(8)]);
  const elements = messages.map(m => Buffer.concat([oscInt(m.length), m]));
  return Buffer.concat([header, ...elements]);
}

/** Feed a packet straight into the parser, bypassing the UDP socket. */
function feed(mgr: TuioManager, packet: Buffer): void {
  (mgr as any).handlePacket(packet);
}

describe('TuioManager', () => {
  let mgr: TuioManager;
  let updates: TuioCursor[];
  let removals: { id: number }[];

  beforeEach(() => {
    mgr = new TuioManager();
    updates = [];
    removals = [];
    mgr.on('cursor-update', (c: TuioCursor) => updates.push(c));
    mgr.on('cursor-remove', (r: { id: number }) => removals.push(r));
  });

  // ---- Lifecycle ----
  describe('lifecycle', () => {
    it('defaults to the TUIO port 3333', () => {
      expect(new TuioManager().listenPort).toBe(3333);
    });

    it('honours a custom port', () => {
      expect(new TuioManager(3334).listenPort).toBe(3334);
    });

    it('stop() is safe to call before start()', () => {
      expect(() => mgr.stop()).not.toThrow();
    });

    it('stop() clears tracked cursors', () => {
      feed(mgr, setMessage(1, 0.5, 0.5));
      mgr.stop();
      // With the cursor forgotten, an empty alive list has nothing to remove.
      feed(mgr, aliveMessage([]));
      expect(removals).toEqual([]);
    });
  });

  // ---- set ----
  describe('set messages', () => {
    it('emits cursor-update with the id and coordinates', () => {
      feed(mgr, setMessage(7, 0.25, 0.75));
      expect(updates).toHaveLength(1);
      expect(updates[0].id).toBe(7);
      expect(updates[0].x).toBeCloseTo(0.25, 5);
      expect(updates[0].y).toBeCloseTo(0.75, 5);
    });

    it('emits an update for each of several cursors', () => {
      feed(mgr, setMessage(1, 0.1, 0.1));
      feed(mgr, setMessage(2, 0.9, 0.9));
      expect(updates.map(u => u.id)).toEqual([1, 2]);
    });

    it('emits an update when an existing cursor moves', () => {
      feed(mgr, setMessage(1, 0.1, 0.1));
      feed(mgr, setMessage(1, 0.2, 0.3));
      expect(updates).toHaveLength(2);
      expect(updates[1].x).toBeCloseTo(0.2, 5);
    });

    it('handles the 0,0 corner', () => {
      feed(mgr, setMessage(1, 0, 0));
      expect(updates[0]).toMatchObject({ id: 1, x: 0, y: 0 });
    });
  });

  // ---- alive ----
  describe('alive messages', () => {
    it('removes a cursor that is no longer listed', () => {
      feed(mgr, setMessage(1, 0.5, 0.5));
      feed(mgr, aliveMessage([]));
      expect(removals).toEqual([{ id: 1 }]);
    });

    it('keeps a cursor that is still listed', () => {
      feed(mgr, setMessage(1, 0.5, 0.5));
      feed(mgr, aliveMessage([1]));
      expect(removals).toEqual([]);
    });

    it('removes only the cursors that dropped out', () => {
      feed(mgr, setMessage(1, 0.1, 0.1));
      feed(mgr, setMessage(2, 0.2, 0.2));
      feed(mgr, setMessage(3, 0.3, 0.3));
      feed(mgr, aliveMessage([2]));
      expect(removals.map(r => r.id).sort()).toEqual([1, 3]);
    });

    it('does not re-emit a removal for an already-removed cursor', () => {
      feed(mgr, setMessage(1, 0.5, 0.5));
      feed(mgr, aliveMessage([]));
      feed(mgr, aliveMessage([]));
      expect(removals).toHaveLength(1);
    });

    it('emits nothing when no cursors are being tracked', () => {
      feed(mgr, aliveMessage([]));
      expect(removals).toEqual([]);
      expect(updates).toEqual([]);
    });
  });

  // ---- Bundles ----
  describe('OSC bundles', () => {
    it('parses a set message inside a bundle', () => {
      feed(mgr, bundle(setMessage(5, 0.4, 0.6)));
      expect(updates).toHaveLength(1);
      expect(updates[0].id).toBe(5);
    });

    it('parses every message in a multi-element bundle', () => {
      // TUIO senders typically bundle alive + set + fseq in one packet.
      feed(mgr, bundle(setMessage(1, 0.1, 0.1), setMessage(2, 0.2, 0.2)));
      expect(updates.map(u => u.id)).toEqual([1, 2]);
    });

    it('applies a set and a subsequent alive from the same bundle in order', () => {
      feed(mgr, bundle(setMessage(1, 0.1, 0.1)));
      feed(mgr, bundle(setMessage(2, 0.2, 0.2), aliveMessage([2])));
      expect(removals).toEqual([{ id: 1 }]);
    });
  });

  // ---- Robustness against untrusted input ----
  // These arrive over UDP from anything on the network, so nothing here may
  // throw — a malformed packet must be dropped silently.
  describe('malformed and foreign packets', () => {
    it('ignores a message for a different OSC address', () => {
      const other = Buffer.concat([
        oscString('/tuio/2Dobj'), oscString(',siffff'), oscString('set'),
        oscInt(1), oscFloat(0.5), oscFloat(0.5), oscFloat(0), oscFloat(0),
      ]);
      feed(mgr, other);
      expect(updates).toEqual([]);
    });

    it('ignores fseq messages', () => {
      const fseq = Buffer.concat([oscString('/tuio/2Dcur'), oscString(',si'), oscString('fseq'), oscInt(42)]);
      expect(() => feed(mgr, fseq)).not.toThrow();
      expect(updates).toEqual([]);
    });

    it('ignores a source message', () => {
      const src = Buffer.concat([oscString('/tuio/2Dcur'), oscString(',ss'), oscString('source'), oscString('app@host')]);
      expect(() => feed(mgr, src)).not.toThrow();
      expect(updates).toEqual([]);
    });

    it.each([
      ['an empty buffer', Buffer.alloc(0)],
      ['random bytes', Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05])],
      ['an address with no null terminator', Buffer.from('/tuio/2Dcur', 'ascii')],
      ['a truncated set message', setMessage(1, 0.5, 0.5).subarray(0, 20)],
      ['a bundle with a bogus element size', Buffer.concat([oscString('#bundle'), Buffer.alloc(8), oscInt(9999)])],
      ['a bundle with a negative element size', Buffer.concat([oscString('#bundle'), Buffer.alloc(8), oscInt(-4)])],
      ['a type tag that is not a type tag', Buffer.concat([oscString('/tuio/2Dcur'), oscString('xyz')])],
      ['a set message with no arguments', Buffer.concat([oscString('/tuio/2Dcur'), oscString(',s'), oscString('set')])],
    ])('drops %s without throwing', (_label, packet) => {
      expect(() => feed(mgr, packet as Buffer)).not.toThrow();
      expect(updates).toEqual([]);
    });

    it('does not emit for a set message whose type tags do not match iffff', () => {
      const wrong = Buffer.concat([oscString('/tuio/2Dcur'), oscString(',sif'), oscString('set'), oscInt(1), oscFloat(0.5)]);
      feed(mgr, wrong);
      expect(updates).toEqual([]);
    });
  });

  // ---- Remote denial-of-service regression ----
  // The bundle walker advanced `offset` by the element size the packet itself
  // declared. A negative size moved it backwards, so a single 20-byte UDP
  // datagram spun the main process forever — freezing the UI, MIDI and mixer
  // control. The socket binds 0.0.0.0:3333, so any host on the network could
  // send it. Each case must return promptly rather than loop.
  describe('bundle walker terminates on hostile element sizes', () => {
    const oscIntOf = (n: number) => oscInt(n);
    const header = () => Buffer.concat([oscString('#bundle'), Buffer.alloc(8)]);

    it.each([
      ['negative (the original hang)', -4],
      ['negative and misaligned', -1],
      ['zero', 0],
      ['misaligned positive', 7],
      ['larger than the packet', 4096],
      ['Int32 minimum', -2147483648],
    ])('terminates on an element size that is %s', (_label, size) => {
      const packet = Buffer.concat([header(), oscIntOf(size), Buffer.alloc(16)]);
      const start = Date.now();
      feed(mgr, packet);
      // A spin would never reach this line; the bound catches a regression
      // that merely slows the walker down rather than hanging it outright.
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it('still parses a well-formed bundle after a hostile one', () => {
      feed(mgr, Buffer.concat([header(), oscInt(-4), Buffer.alloc(16)]));
      feed(mgr, bundle(setMessage(9, 0.5, 0.5)));
      expect(updates.map(u => u.id)).toEqual([9]);
    });
  });
});

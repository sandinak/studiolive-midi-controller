/**
 * Socket lifecycle for TuioManager, against a mocked dgram.
 *
 * Kept apart from tuio-manager.test.ts (which drives the parser directly) so
 * the dgram mock doesn't apply to the parsing tests.
 */

jest.mock('dgram', () => ({
  createSocket: jest.fn(() => {
    const s = new (require('events').EventEmitter)();
    s.bind = jest.fn();
    s.close = jest.fn();
    return s;
  }),
}));

import { createSocket } from 'dgram';
import { TuioManager } from '../../src/main/tuio-manager';

const mockCreateSocket = createSocket as unknown as jest.Mock;

/** The socket handed to the manager by the most recent start(). */
function lastSocket(): any {
  return mockCreateSocket.mock.results[mockCreateSocket.mock.results.length - 1].value;
}

describe('TuioManager socket lifecycle', () => {
  let mgr: TuioManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mgr = new TuioManager(3333);
  });

  it('binds a UDP socket on the configured port', () => {
    mgr.start();
    expect(mockCreateSocket).toHaveBeenCalledWith('udp4');
    expect(lastSocket().bind).toHaveBeenCalledWith(3333);
  });

  it('binds the custom port when one is given', () => {
    new TuioManager(9999).start();
    expect(lastSocket().bind).toHaveBeenCalledWith(9999);
  });

  it('is idempotent — a second start() does not open another socket', () => {
    mgr.start();
    mgr.start();
    expect(mockCreateSocket).toHaveBeenCalledTimes(1);
  });

  it('closes the socket on stop()', () => {
    mgr.start();
    const socket = lastSocket();
    mgr.stop();
    expect(socket.close).toHaveBeenCalled();
  });

  it('can be restarted after stop()', () => {
    mgr.start();
    mgr.stop();
    mgr.start();
    expect(mockCreateSocket).toHaveBeenCalledTimes(2);
  });

  it('routes datagrams into the parser', () => {
    const updates: any[] = [];
    mgr.on('cursor-update', (c) => updates.push(c));
    mgr.start();

    // A /tuio/2Dcur set message, built the same way the parser tests do.
    const str = (s: string) => {
      const b = Buffer.alloc(Math.ceil((s.length + 1) / 4) * 4);
      b.write(s, 0, 'ascii');
      return b;
    };
    const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b; };
    const f32 = (n: number) => { const b = Buffer.alloc(4); b.writeFloatBE(n, 0); return b; };
    const packet = Buffer.concat([
      str('/tuio/2Dcur'), str(',siffff'), str('set'),
      i32(3), f32(0.5), f32(0.5), f32(0), f32(0),
    ]);

    lastSocket().emit('message', packet);
    expect(updates).toEqual([{ id: 3, x: 0.5, y: 0.5 }]);
  });

  // ---- Bind failure ----
  // Port 3333 is commonly already held by PreSonus Universal Control, so a
  // bind error has to degrade to "no TUIO" rather than take the app down.
  describe('when the port is already in use', () => {
    it('does not throw', () => {
      mgr.start();
      expect(() => lastSocket().emit('error', new Error('EADDRINUSE'))).not.toThrow();
    });

    it('closes the failed socket', () => {
      mgr.start();
      const socket = lastSocket();
      socket.emit('error', new Error('EADDRINUSE'));
      expect(socket.close).toHaveBeenCalled();
    });

    it('allows a later start() to retry', () => {
      mgr.start();
      lastSocket().emit('error', new Error('EADDRINUSE'));
      mgr.start();
      expect(mockCreateSocket).toHaveBeenCalledTimes(2);
    });

    it('survives createSocket itself throwing', () => {
      mockCreateSocket.mockImplementationOnce(() => { throw new Error('no sockets'); });
      expect(() => mgr.start()).not.toThrow();
    });
  });

  it('stop() tolerates close() throwing', () => {
    mgr.start();
    lastSocket().close.mockImplementation(() => { throw new Error('already closed'); });
    expect(() => mgr.stop()).not.toThrow();
  });
});

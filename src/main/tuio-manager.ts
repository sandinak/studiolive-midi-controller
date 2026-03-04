import { EventEmitter } from 'events';
import { createSocket, Socket } from 'dgram';

export interface TuioCursor {
  id: number;
  x: number;
  y: number;
}

/**
 * Minimal TUIO 1.1 / OSC listener.
 * Parses /tuio/2Dcur messages received over UDP (default port 3333)
 * and emits 'cursor-update' and 'cursor-remove' events.
 *
 * TUIO senders: TouchOSC, Lemur, or any app with TUIO output support.
 * Protocol: OSC messages over UDP — no external library needed.
 */
export class TuioManager extends EventEmitter {
  private socket: Socket | null = null;
  private activeCursors = new Map<number, TuioCursor>();
  private port: number;

  constructor(port = 3333) {
    super();
    this.port = port;
  }

  get listenPort(): number {
    return this.port;
  }

  start(): void {
    if (this.socket) return;
    try {
      this.socket = createSocket('udp4');
      this.socket.on('message', (buf) => this.handlePacket(buf));
      this.socket.on('error', (err) => {
        // Port may already be in use (UC Surface, etc.) — log and continue without TUIO
        console.warn(`[TUIO] UDP bind error on port ${this.port}:`, err.message);
        this.socket?.close();
        this.socket = null;
      });
      this.socket.bind(this.port);
    } catch (err) {
      console.warn('[TUIO] Failed to start:', err);
      this.socket = null;
    }
  }

  stop(): void {
    if (this.socket) {
      try { this.socket.close(); } catch (_) {}
      this.socket = null;
    }
    this.activeCursors.clear();
  }

  // ---------------------------------------------------------------------------
  // OSC / TUIO parsing (no external dependency)
  // ---------------------------------------------------------------------------

  private handlePacket(buf: Buffer): void {
    try {
      if (buf[0] === 0x23) {
        // OSC bundle: "#bundle\0" + timetag (8 bytes) + size-prefixed messages
        let offset = 16; // skip "#bundle\0" (8) + timetag (8)
        while (offset < buf.length) {
          const size = buf.readInt32BE(offset);
          offset += 4;
          if (size > 0 && offset + size <= buf.length) {
            this.parseOscMessage(buf, offset, size);
          }
          offset += size;
        }
      } else {
        // Single OSC message
        this.parseOscMessage(buf, 0, buf.length);
      }
    } catch (_) {
      // Ignore malformed packets
    }
  }

  private parseOscMessage(buf: Buffer, start: number, _len: number): void {
    let offset = start;

    // Read address string
    const addrEnd = buf.indexOf(0, offset);
    if (addrEnd === -1) return;
    const address = buf.toString('ascii', offset, addrEnd);
    offset = align4(addrEnd + 1);

    if (address !== '/tuio/2Dcur') return;

    // Read type tag string (starts with ',')
    if (buf[offset] !== 0x2c) return;
    const tagEnd = buf.indexOf(0, offset);
    if (tagEnd === -1) return;
    const typeTags = buf.toString('ascii', offset + 1, tagEnd); // skip the ','
    offset = align4(tagEnd + 1);

    // First arg should be a string (the TUIO message type)
    if (!typeTags.startsWith('s')) return;
    const strEnd = buf.indexOf(0, offset);
    if (strEnd === -1) return;
    const msgType = buf.toString('ascii', offset, strEnd);
    offset = align4(strEnd + 1);

    const remaining = typeTags.slice(1);

    if (msgType === 'set' && remaining.startsWith('iffff')) {
      // set: sessionId(i) x(f) y(f) xVel(f) yVel(f) [accel(f)]
      const id = buf.readInt32BE(offset); offset += 4;
      const x  = buf.readFloatBE(offset); offset += 4;
      const y  = buf.readFloatBE(offset); offset += 4;
      const cursor: TuioCursor = { id, x, y };
      this.activeCursors.set(id, cursor);
      this.emit('cursor-update', cursor);

    } else if (msgType === 'alive') {
      // alive: zero or more int32 session IDs
      const aliveIds = new Set<number>();
      let i = 0;
      while (i < remaining.length && remaining[i] === 'i') {
        aliveIds.add(buf.readInt32BE(offset));
        offset += 4;
        i++;
      }
      for (const [id] of this.activeCursors) {
        if (!aliveIds.has(id)) {
          this.activeCursors.delete(id);
          this.emit('cursor-remove', { id });
        }
      }
    }
    // 'fseq' and 'source' messages are ignored
  }
}

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

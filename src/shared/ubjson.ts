/**
 * UBJSON codec for console documents.
 *
 * The console's native document format is UBJSON, not JSON. A `.bak` archive
 * contains JSON because Universal Control re-serialises on the way to disk; on
 * the wire a scene arrives as zlib-compressed UBJSON (82,831 bytes of UBJSON for
 * a scene that is 131,134 bytes as JSON text).
 *
 * The protocol library already has a UBJSON reader, used for the state tree, but
 * it implements only the subset that tree happens to contain. Pointed at a real
 * preset document it throws `Unknown type 73` — that is `I`, int16, which
 * documents use and the state tree apparently does not. It also assumes every
 * string and key length is a one-byte `i`, which holds until a key or value is
 * longer than 127 bytes.
 *
 * So this is a complete implementation of the value types UBJSON defines, and it
 * **encodes** as well as decodes. The encoder has no counterpart anywhere in the
 * library and is what pushing a document back to the console will need: a restore
 * has to hand the console UBJSON, because that is what it speaks.
 *
 * Numbers are big-endian, per the UBJSON specification — which is worth stating
 * because the rest of this protocol is little-endian, and mixing the two up
 * produces plausible-looking garbage rather than an error.
 */

// Type markers.
const NULL = 0x5a;        // Z
const NOOP = 0x4e;        // N
const TRUE = 0x54;        // T
const FALSE = 0x46;       // F
const INT8 = 0x69;        // i
const UINT8 = 0x55;       // U
const INT16 = 0x49;       // I
const INT32 = 0x6c;       // l
const INT64 = 0x4c;       // L
const FLOAT32 = 0x64;     // d
const FLOAT64 = 0x44;     // D
const HIGH_PRECISION = 0x48; // H
const CHAR = 0x43;        // C
const STRING = 0x53;      // S
const OBJECT_OPEN = 0x7b; // {
const OBJECT_CLOSE = 0x7d; // }
const ARRAY_OPEN = 0x5b;  // [
const ARRAY_CLOSE = 0x5d; // ]

export class UbjsonError extends Error {
  constructor(message: string, readonly position?: number) {
    super(position === undefined ? message : `${message} (at byte ${position})`);
    this.name = 'UbjsonError';
  }
}

/** A decoded UBJSON value. Integers wider than 2^53 arrive as BigInt. */
export type UbjsonValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | UbjsonValue[]
  | { [key: string]: UbjsonValue };

// ─── Decode ────────────────────────────────────────────────────────────────

class Reader {
  position = 0;
  constructor(private readonly buf: Buffer) {}

  get done(): boolean {
    return this.position >= this.buf.length;
  }

  need(n: number): void {
    if (this.position + n > this.buf.length) {
      throw new UbjsonError(`truncated: need ${n} more byte(s)`, this.position);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.position++];
  }

  peek(): number {
    this.need(1);
    return this.buf[this.position];
  }

  take(n: number): Buffer {
    this.need(n);
    const out = this.buf.subarray(this.position, this.position + n);
    this.position += n;
    return out;
  }
}

/**
 * Read a length, which UBJSON encodes as any integer type rather than a fixed
 * width. The library's reader assumes a one-byte `i`, which is why a key or
 * string longer than 127 bytes would break it.
 */
function readLength(r: Reader): number {
  const marker = r.u8();
  const value = readIntegerByMarker(r, marker);
  if (typeof value === 'bigint') {
    throw new UbjsonError('length does not fit in a JavaScript number', r.position);
  }
  if (value < 0) throw new UbjsonError(`negative length ${value}`, r.position);
  return value;
}

function readIntegerByMarker(r: Reader, marker: number): number | bigint {
  switch (marker) {
    case INT8: return r.take(1).readInt8();
    case UINT8: return r.take(1).readUInt8();
    case INT16: return r.take(2).readInt16BE();
    case INT32: return r.take(4).readInt32BE();
    case INT64: {
      const big = r.take(8).readBigInt64BE();
      // Keep it a number when it fits, so arithmetic on ordinary values does
      // not suddenly need BigInt. Colours arrive as int64 and are small enough.
      return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(big)
        : big;
    }
    default:
      throw new UbjsonError(
        `expected an integer type marker, got 0x${marker.toString(16)}`,
        r.position,
      );
  }
}

function readValue(r: Reader, marker: number): UbjsonValue {
  switch (marker) {
    case NULL: return null;
    case TRUE: return true;
    case FALSE: return false;
    case INT8:
    case UINT8:
    case INT16:
    case INT32:
    case INT64:
      return readIntegerByMarker(r, marker);
    case FLOAT32: return r.take(4).readFloatBE();
    case FLOAT64: return r.take(8).readDoubleBE();
    case CHAR: return String.fromCharCode(r.take(1).readUInt8());
    case STRING: return r.take(readLength(r)).toString('utf8');
    // A high-precision number is a decimal string. Kept as a string rather than
    // silently losing precision by coercing to a double.
    case HIGH_PRECISION: return r.take(readLength(r)).toString('utf8');
    case OBJECT_OPEN: return readObject(r);
    case ARRAY_OPEN: return readArray(r);
    default:
      throw new UbjsonError(`unknown type marker 0x${marker.toString(16)}`, r.position);
  }
}

function readObject(r: Reader): { [key: string]: UbjsonValue } {
  const out: { [key: string]: UbjsonValue } = {};
  for (;;) {
    if (r.done) throw new UbjsonError('unterminated object', r.position);
    const marker = r.u8();
    if (marker === OBJECT_CLOSE) return out;
    if (marker === NOOP) continue;
    // A key is a length-prefixed string with no `S` marker of its own.
    const key = r.take(readIntegerByMarker(r, marker) as number).toString('utf8');
    out[key] = readValue(r, r.u8());
  }
}

function readArray(r: Reader): UbjsonValue[] {
  const out: UbjsonValue[] = [];
  for (;;) {
    if (r.done) throw new UbjsonError('unterminated array', r.position);
    const marker = r.u8();
    if (marker === ARRAY_CLOSE) return out;
    if (marker === NOOP) continue;
    out.push(readValue(r, marker));
  }
}

/**
 * Decode a UBJSON document.
 *
 * Trailing bytes after the top-level value are an error rather than ignored: a
 * document that does not consume its buffer usually means the transfer was
 * reassembled wrongly, and silently returning the first half of a scene is the
 * worst possible outcome for a backup.
 */
export function decodeUbjson(buf: Buffer): UbjsonValue {
  if (!Buffer.isBuffer(buf)) throw new UbjsonError('expected a Buffer');
  if (buf.length === 0) throw new UbjsonError('empty buffer');
  const r = new Reader(buf);
  const value = readValue(r, r.u8());
  while (!r.done && r.peek() === NOOP) r.u8();
  if (!r.done) {
    throw new UbjsonError(
      `${buf.length - r.position} unconsumed byte(s) after the top-level value`,
      r.position,
    );
  }
  return value;
}

// ─── Encode ────────────────────────────────────────────────────────────────

/**
 * Which marker to use for an integer. Narrowest that fits, which is what the
 * console's own encoder appears to do — documents contain `i`, `I` and `l` for
 * values of different magnitudes.
 */
function encodeInteger(value: number | bigint): Buffer {
  if (typeof value === 'bigint') {
    const b = Buffer.alloc(9);
    b.writeUInt8(INT64, 0);
    b.writeBigInt64BE(value, 1);
    return b;
  }
  if (!Number.isInteger(value)) throw new UbjsonError(`not an integer: ${value}`);
  if (value >= 0 && value <= 255) {
    // Prefer int8 for values it can hold, matching what real documents use for
    // small counts and flags; uint8 covers 128..255.
    const b = Buffer.alloc(2);
    if (value <= 127) { b.writeUInt8(INT8, 0); b.writeInt8(value, 1); }
    else { b.writeUInt8(UINT8, 0); b.writeUInt8(value, 1); }
    return b;
  }
  if (value >= -128 && value < 0) {
    const b = Buffer.alloc(2);
    b.writeUInt8(INT8, 0);
    b.writeInt8(value, 1);
    return b;
  }
  if (value >= -32768 && value <= 32767) {
    const b = Buffer.alloc(3);
    b.writeUInt8(INT16, 0);
    b.writeInt16BE(value, 1);
    return b;
  }
  if (value >= -2147483648 && value <= 2147483647) {
    const b = Buffer.alloc(5);
    b.writeUInt8(INT32, 0);
    b.writeInt32BE(value, 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b.writeUInt8(INT64, 0);
  b.writeBigInt64BE(BigInt(value), 1);
  return b;
}

/** A length prefix, as used for keys and strings: an integer with its marker. */
function encodeLength(n: number): Buffer {
  return encodeInteger(n);
}

function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from([STRING]), encodeLength(bytes.length), bytes]);
}

/**
 * Encode a value as UBJSON.
 *
 * Floats are written as float32, because that is what the console stores and
 * what its documents contain — writing float64 would be a wider type than the
 * DSP can hold and is not a shape the console has been observed to produce.
 */
export function encodeUbjson(value: UbjsonValue): Buffer {
  const parts: Buffer[] = [];

  const write = (v: UbjsonValue): void => {
    if (v === null) { parts.push(Buffer.from([NULL])); return; }
    if (v === true) { parts.push(Buffer.from([TRUE])); return; }
    if (v === false) { parts.push(Buffer.from([FALSE])); return; }

    if (typeof v === 'bigint') { parts.push(encodeInteger(v)); return; }

    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        throw new UbjsonError(`cannot encode a non-finite number (${v})`);
      }
      if (Number.isInteger(v)) { parts.push(encodeInteger(v)); return; }
      const b = Buffer.alloc(5);
      b.writeUInt8(FLOAT32, 0);
      b.writeFloatBE(v, 1);
      parts.push(b);
      return;
    }

    if (typeof v === 'string') { parts.push(encodeString(v)); return; }

    if (Array.isArray(v)) {
      parts.push(Buffer.from([ARRAY_OPEN]));
      for (const item of v) write(item);
      parts.push(Buffer.from([ARRAY_CLOSE]));
      return;
    }

    if (typeof v === 'object') {
      parts.push(Buffer.from([OBJECT_OPEN]));
      for (const [key, child] of Object.entries(v)) {
        if (child === undefined) {
          throw new UbjsonError(`cannot encode undefined at key ${JSON.stringify(key)}`);
        }
        const keyBytes = Buffer.from(key, 'utf8');
        // A key is a bare length-prefixed string, with no `S` marker.
        parts.push(encodeLength(keyBytes.length), keyBytes);
        write(child as UbjsonValue);
      }
      parts.push(Buffer.from([OBJECT_CLOSE]));
      return;
    }

    throw new UbjsonError(`cannot encode a value of type ${typeof v}`);
  };

  write(value);
  return Buffer.concat(parts);
}

/**
 * The UBJSON codec.
 *
 * Validated against reality before these tests existed: all 69 documents from a
 * real console transfer decode, round-trip through the encoder, and come out
 * semantically identical to the JSON Universal Control wrote into its own backup
 * archive. These cover the pieces of that, plus the cases the protocol library's
 * own reader gets wrong — it throws `Unknown type 73` on a real preset document,
 * because it implements only the subset the state tree happens to use.
 */

import { decodeUbjson, encodeUbjson, UbjsonError } from '../../src/shared/ubjson';

/** Build a buffer from markers and bytes, for readability. */
const b = (...parts: (number | string | Buffer)[]): Buffer =>
  Buffer.concat(parts.map((p) =>
    typeof p === 'number' ? Buffer.from([p])
      : typeof p === 'string' ? Buffer.from(p, 'utf8')
        : p));

const M = {
  null: 0x5a, true: 0x54, false: 0x46, noop: 0x4e,
  int8: 0x69, uint8: 0x55, int16: 0x49, int32: 0x6c, int64: 0x4c,
  float32: 0x64, float64: 0x44, char: 0x43, string: 0x53, highPrecision: 0x48,
  objOpen: 0x7b, objClose: 0x7d, arrOpen: 0x5b, arrClose: 0x5d,
};

/** `{"k": <value bytes>}` — a key is a bare length-prefixed string. */
const wrap = (key: string, ...value: (number | string | Buffer)[]) =>
  b(M.objOpen, M.int8, key.length, key, ...value, M.objClose);

describe('decodeUbjson', () => {
  describe('integer types', () => {
    it('reads int8', () => {
      expect(decodeUbjson(wrap('v', M.int8, 0x2a))).toEqual({ v: 42 });
    });

    it('reads a negative int8', () => {
      expect(decodeUbjson(wrap('v', M.int8, 0xd6))).toEqual({ v: -42 });
    });

    it('reads uint8 above the int8 range', () => {
      expect(decodeUbjson(wrap('v', M.uint8, 0xff))).toEqual({ v: 255 });
    });

    // The marker that makes the protocol library throw `Unknown type 73`. Real
    // preset documents contain it; the state tree apparently does not.
    it('reads int16, which the library cannot', () => {
      const payload = Buffer.alloc(2);
      payload.writeInt16BE(-12345);
      expect(decodeUbjson(wrap('v', M.int16, payload))).toEqual({ v: -12345 });
    });

    it('reads int32', () => {
      const payload = Buffer.alloc(4);
      payload.writeInt32BE(1234567);
      expect(decodeUbjson(wrap('v', M.int32, payload))).toEqual({ v: 1234567 });
    });

    // Colours arrive as int64 and are well inside the safe range, so they come
    // back as ordinary numbers rather than forcing BigInt arithmetic on callers.
    it('reads int64 as a number when it fits safely', () => {
      const payload = Buffer.alloc(8);
      payload.writeBigInt64BE(4278190335n);
      expect(decodeUbjson(wrap('color', M.int64, payload))).toEqual({ color: 4278190335 });
    });

    it('reads int64 as a BigInt when it does not fit', () => {
      const payload = Buffer.alloc(8);
      payload.writeBigInt64BE(9007199254740993n);
      expect(decodeUbjson(wrap('v', M.int64, payload))).toEqual({ v: 9007199254740993n });
    });
  });

  describe('other value types', () => {
    // Big-endian, per the UBJSON spec — and worth pinning, because the rest of
    // this protocol is little-endian and confusing the two yields plausible
    // garbage rather than an error.
    it('reads float32 big-endian', () => {
      const payload = Buffer.alloc(4);
      payload.writeFloatBE(-84.5);
      expect(decodeUbjson(wrap('volume', M.float32, payload))).toEqual({ volume: -84.5 });
    });

    it('reads float64', () => {
      const payload = Buffer.alloc(8);
      payload.writeDoubleBE(0.1);
      expect(decodeUbjson(wrap('v', M.float64, payload))).toEqual({ v: 0.1 });
    });

    it('reads a string', () => {
      expect(decodeUbjson(wrap('username', M.string, M.int8, 5, 'Piano')))
        .toEqual({ username: 'Piano' });
    });

    it('reads a UTF-8 string by byte length', () => {
      const text = 'Café';
      const bytes = Buffer.from(text, 'utf8');
      expect(decodeUbjson(wrap('v', M.string, M.int8, bytes.length, bytes)))
        .toEqual({ v: text });
    });

    it('reads an empty string', () => {
      expect(decodeUbjson(wrap('iconid', M.string, M.int8, 0))).toEqual({ iconid: '' });
    });

    it.each([
      ['null', M.null, null],
      ['true', M.true, true],
      ['false', M.false, false],
    ])('reads %s', (_label, marker, expected) => {
      expect(decodeUbjson(wrap('v', marker))).toEqual({ v: expected });
    });

    it('reads a char', () => {
      expect(decodeUbjson(wrap('v', M.char, 0x41))).toEqual({ v: 'A' });
    });

    // Coercing to a double would silently lose the precision the type exists to
    // preserve, so it stays a string.
    it('keeps a high-precision number as a string', () => {
      expect(decodeUbjson(wrap('v', M.highPrecision, M.int8, 5, '1.234')))
        .toEqual({ v: '1.234' });
    });
  });

  describe('length prefixes', () => {
    // The library assumes every length is a one-byte `i`, which holds only while
    // keys and strings stay under 128 bytes.
    it('reads a string whose length needs int16', () => {
      const text = 'x'.repeat(300);
      const len = Buffer.alloc(2);
      len.writeInt16BE(300);
      expect(decodeUbjson(wrap('v', M.string, M.int16, len, text))).toEqual({ v: text });
    });

    it('reads a key longer than 127 bytes', () => {
      const key = 'k'.repeat(200);
      const len = Buffer.alloc(2);
      len.writeInt16BE(key.length);
      const buf = b(M.objOpen, M.int16, len, key, M.int8, 1, M.objClose);
      expect(decodeUbjson(buf)).toEqual({ [key]: 1 });
    });
  });

  describe('structure', () => {
    it('reads nested objects', () => {
      const inner = b(M.objOpen, M.int8, 3, 'hpf', M.int8, 24, M.objClose);
      expect(decodeUbjson(wrap('filter', inner))).toEqual({ filter: { hpf: 24 } });
    });

    it('reads an empty object', () => {
      expect(decodeUbjson(wrap('opt', M.objOpen, M.objClose))).toEqual({ opt: {} });
    });

    it('reads an array', () => {
      expect(decodeUbjson(wrap('v', M.arrOpen, M.int8, 1, M.int8, 2, M.arrClose)))
        .toEqual({ v: [1, 2] });
    });

    it('reads an empty array', () => {
      expect(decodeUbjson(wrap('v', M.arrOpen, M.arrClose))).toEqual({ v: [] });
    });

    it('reads an array of objects', () => {
      const obj = b(M.objOpen, M.int8, 1, 'a', M.int8, 1, M.objClose);
      expect(decodeUbjson(wrap('v', M.arrOpen, obj, M.arrClose))).toEqual({ v: [{ a: 1 }] });
    });

    it('skips no-op markers', () => {
      const buf = b(M.objOpen, M.noop, M.int8, 1, 'a', M.int8, 7, M.noop, M.objClose);
      expect(decodeUbjson(buf)).toEqual({ a: 7 });
    });

    it('preserves key order', () => {
      const buf = b(M.objOpen,
        M.int8, 1, 'z', M.int8, 1,
        M.int8, 1, 'a', M.int8, 2,
        M.objClose);
      expect(Object.keys(decodeUbjson(buf) as object)).toEqual(['z', 'a']);
    });
  });

  describe('refusals', () => {
    it('rejects a non-Buffer', () => {
      expect(() => decodeUbjson('nope' as never)).toThrow(UbjsonError);
    });

    it('rejects an empty buffer', () => {
      expect(() => decodeUbjson(Buffer.alloc(0))).toThrow(/empty buffer/);
    });

    it('rejects an unknown marker and says which', () => {
      expect(() => decodeUbjson(wrap('v', 0x99))).toThrow(/unknown type marker 0x99/);
    });

    it('rejects a truncated value', () => {
      expect(() => decodeUbjson(b(M.objOpen, M.int8, 1, 'a', M.int32, 0x00, 0x00)))
        .toThrow(/truncated/);
    });

    it('rejects an unterminated object', () => {
      expect(() => decodeUbjson(b(M.objOpen, M.int8, 1, 'a', M.int8, 1)))
        .toThrow(/unterminated object/);
    });

    it('rejects an unterminated array', () => {
      expect(() => decodeUbjson(b(M.arrOpen, M.int8, 1))).toThrow(/unterminated array/);
    });

    // Returning the first half of a scene because the transfer was reassembled
    // wrongly is the worst outcome for a backup, so trailing bytes are an error.
    it('rejects unconsumed trailing bytes', () => {
      const buf = Buffer.concat([wrap('a', M.int8, 1), Buffer.from([0x00, 0x00])]);
      expect(() => decodeUbjson(buf)).toThrow(/unconsumed byte/);
    });

    it('reports the position of a failure', () => {
      try {
        decodeUbjson(wrap('v', 0x99));
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as UbjsonError).message).toMatch(/at byte \d+/);
      }
    });
  });
});

describe('encodeUbjson', () => {
  const roundTrip = (value: unknown) => decodeUbjson(encodeUbjson(value as never));

  it.each([
    ['an int8', { v: 42 }],
    ['a negative int8', { v: -42 }],
    ['a uint8 value', { v: 200 }],
    ['an int16 value', { v: 30000 }],
    ['a negative int16', { v: -30000 }],
    ['an int32 value', { v: 1234567 }],
    ['a colour-sized integer', { color: 4278190335 }],
    ['zero', { v: 0 }],
    ['a string', { username: 'Piano' }],
    ['an empty string', { iconid: '' }],
    ['a UTF-8 string', { v: 'Café — ok' }],
    ['null', { v: null }],
    ['booleans', { a: true, b: false }],
    ['an empty object', { opt: {} }],
    ['an empty array', { v: [] }],
    ['nesting', { line: { ch1: { filter: { hpf: 24 } } } }],
    ['an array', { v: [1, 2, 3] }],
    ['an array of objects', { v: [{ a: 1 }, { b: 2 }] }],
  ])('round-trips %s', (_label, value) => {
    expect(roundTrip(value)).toEqual(value);
  });

  it('round-trips a BigInt too large for a number', () => {
    expect(roundTrip({ v: 9007199254740993n })).toEqual({ v: 9007199254740993n });
  });

  // float32 is what the console stores, so a fraction narrows to it rather than
  // being written as a float64 the DSP cannot hold.
  it('round-trips a fraction through float32 precision', () => {
    const decoded = roundTrip({ volume: -84.5 }) as { volume: number };
    expect(decoded.volume).toBeCloseTo(-84.5, 4);
  });

  it('uses the narrowest integer type that fits', () => {
    // int8 costs 2 bytes with its marker, int32 costs 5.
    expect(encodeUbjson({ v: 1 } as never).length)
      .toBeLessThan(encodeUbjson({ v: 1234567 } as never).length);
  });

  it('writes a key longer than 127 bytes with a wider length prefix', () => {
    const key = 'k'.repeat(200);
    expect(roundTrip({ [key]: 1 })).toEqual({ [key]: 1 });
  });

  it('writes a string longer than 127 bytes', () => {
    const text = 'x'.repeat(500);
    expect(roundTrip({ v: text })).toEqual({ v: text });
  });

  it('preserves key order', () => {
    const value = { z: 1, a: 2, m: 3 };
    expect(Object.keys(roundTrip(value) as object)).toEqual(['z', 'a', 'm']);
  });

  it('round-trips a realistic channel strip', () => {
    const channel = {
      username: '1:Piano', color: 4283284562, iconid: 'keyboards/piano',
      volume: -0.566, preampgain: 13.8, link: 0, '48v': 0, mute: 0,
      filter: { hpf: 24 },
      eq: { eqallon: 1, eqgain1: 0, eqq1: 0.6, eqfreq1: 130, eqbandon1: 1 },
      opt: {},
    };
    const decoded = roundTrip({ line: { ch1: channel } }) as any;
    expect(decoded.line.ch1.username).toBe('1:Piano');
    expect(decoded.line.ch1.color).toBe(4283284562);
    expect(decoded.line.ch1.iconid).toBe('keyboards/piano');
    expect(decoded.line.ch1.opt).toEqual({});
    expect(decoded.line.ch1.volume).toBeCloseTo(-0.566, 4);
  });

  describe('refusals', () => {
    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
    ])('refuses %s rather than writing a wrong value', (_label, v) => {
      expect(() => encodeUbjson({ v } as never)).toThrow(/non-finite/);
    });

    it('refuses undefined rather than dropping the key', () => {
      expect(() => encodeUbjson({ v: undefined } as never)).toThrow(/undefined/);
    });

    it('refuses a function', () => {
      expect(() => encodeUbjson({ v: () => 1 } as never)).toThrow(UbjsonError);
    });
  });
});

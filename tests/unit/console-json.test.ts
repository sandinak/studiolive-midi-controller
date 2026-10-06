/**
 * Serialising a document the way the console does.
 *
 * The expected output here was taken from real console-written files. The two
 * things worth getting right are both invisible to `JSON.parse`: that a
 * float-typed key keeps its trailing `.0`, and that an empty object is written
 * as a block rather than `{}`. Every structural assertion was verified against
 * all six document types in two real archives.
 */

import {
  serialiseConsoleDocument,
  formatConsoleNumber,
  isFloatKey,
  FLOAT_KEYS,
} from '../../src/shared/console-json';

describe('isFloatKey', () => {
  it.each(['volume', 'preampgain', 'hpf', 'threshold', 'attack', 'release', 'ratio', 'pan'])(
    'knows %s is a float',
    (key) => expect(isFloatKey(key)).toBe(true),
  );

  // Numbered families, so the registry need not enumerate every console size.
  it.each(['aux1', 'aux32', 'fx8', 'gain31', 'eqfreq1', 'eqgain6', 'eqq4', 'aux12_pan', 'aux3132_stpan', 'FXA', 'FXH'])(
    'matches the %s family',
    (key) => expect(isFloatKey(key)).toBe(true),
  );

  it.each(['mute', 'solo', 'link', 'eqbandon1', 'eqallon', '48v', 'polarity', 'mutegroup1'])(
    'treats %s as an integer',
    (key) => expect(isFloatKey(key)).toBe(false),
  );

  it('treats an unknown key as an integer', () => {
    expect(isFloatKey('somethingNewInFirmware')).toBe(false);
  });
});

describe('formatConsoleNumber', () => {
  // The difference JSON.stringify cannot express: a float holding a whole
  // number. The console writes -84.0; JavaScript writes -84.
  it.each([
    ['volume', -84, '-84.0'],
    ['hpf', 24, '24.0'],
    ['eqfreq1', 130, '130.0'],
    ['preampgain', 0, '0.0'],
    ['ratio', 2, '2.0'],
  ])('keeps the decimal point on %s', (key, value, expected) => {
    expect(formatConsoleNumber(key, value)).toBe(expected);
  });

  it.each([
    ['mute', 0, '0'],
    ['eqbandon1', 1, '1'],
    ['48v', 0, '0'],
  ])('writes %s as a bare integer', (key, value, expected) => {
    expect(formatConsoleNumber(key, value)).toBe(expected);
  });

  it('uses the shortest round-tripping form for a fraction', () => {
    // The console prints the full float32 expansion; we print the shortest
    // double form. Both narrow to the same float32, so this is safe to lose.
    expect(formatConsoleNumber('hpf', 59.4349250793457)).toBe('59.4349250793457');
  });

  it('writes a fraction on an integer-typed key rather than truncating it', () => {
    // Wrong type for the key, but silently losing the value would be worse.
    expect(formatConsoleNumber('mute', 0.5)).toBe('0.5');
  });

  // JSON.stringify turns these into `null`, which would land in a document as a
  // silently wrong parameter.
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ])('refuses %s', (_label, value) => {
    expect(() => formatConsoleNumber('volume', value)).toThrow(/non-finite/);
  });
});

describe('serialiseConsoleDocument', () => {
  it('uses tabs and puts an object brace on its own line', () => {
    // Matching a real scene: `"opt": \n\t{\n\t\t"swapcompeq": 0\n\t}`
    const out = serialiseConsoleDocument({ opt: { swapcompeq: 0 } });
    expect(out).toBe('{\n\t"opt": \n\t{\n\t\t"swapcompeq": 0\n\t}\n}');
  });

  it('keeps a scalar on the key line', () => {
    expect(serialiseConsoleDocument({ mute: 0 })).toBe('{\n\t"mute": 0\n}');
  });

  // Measured: a real scene contains `"opt": \n{\n\n}` and zero bare `{}`.
  it('writes an empty object as a block with a blank body', () => {
    expect(serialiseConsoleDocument({ opt: {} })).toBe('{\n\t"opt": \n\t{\n\n\t}\n}');
  });

  it('nests to the right depth', () => {
    const out = serialiseConsoleDocument({ line: { ch1: { filter: { hpf: 24 } } } });
    expect(out).toContain('\n\t\t\t"filter": \n\t\t\t{\n\t\t\t\t"hpf": 24.0\n\t\t\t}');
  });

  it('preserves key order', () => {
    const out = serialiseConsoleDocument({ z: 1, a: 2, m: 3 });
    expect(out.indexOf('"z"')).toBeLessThan(out.indexOf('"a"'));
    expect(out.indexOf('"a"')).toBeLessThan(out.indexOf('"m"'));
  });

  it('quotes and escapes strings', () => {
    const out = serialiseConsoleDocument({ username: 'FOH "Main"\\Mix' });
    expect(JSON.parse(out).username).toBe('FOH "Main"\\Mix');
  });

  it('round-trips a realistic channel through JSON.parse', () => {
    const channel = {
      username: 'Piano', color: 4283284562, iconid: 'keyboards/piano',
      volume: -0.5660408735275269, preampgain: 0.8, link: 0, '48v': 0,
      filter: { hpf: 24.0 },
      eq: { eqallon: 1, eqgain1: 0, eqq1: 0.6, eqfreq1: 130, eqbandon1: 1 },
      opt: {},
    };
    expect(JSON.parse(serialiseConsoleDocument({ line: { ch1: channel } })))
      .toEqual({ line: { ch1: channel } });
  });

  it('writes a boolean as 0 or 1, since documents have no booleans', () => {
    // The live state tree coerces several flags to booleans; documents store
    // them as numbers, so a converted value must land as one.
    expect(serialiseConsoleDocument({ mute: true, solo: false }))
      .toBe('{\n\t"mute": 1,\n\t"solo": 0\n}');
  });

  it('writes null through', () => {
    expect(serialiseConsoleDocument({ x: null })).toBe('{\n\t"x": null\n}');
  });

  it('serialises an array as a block', () => {
    expect(serialiseConsoleDocument({ list: [1, 2] }))
      .toBe('{\n\t"list": \n\t[\n\t\t1,\n\t\t2\n\t]\n}');
  });

  // Dropping these silently would lose a parameter, which is the one thing a
  // backup must never do.
  it('refuses undefined', () => {
    expect(() => serialiseConsoleDocument({ x: undefined })).toThrow(/cannot serialise/);
  });

  it('refuses a function', () => {
    expect(() => serialiseConsoleDocument({ x: () => 1 })).toThrow(/cannot serialise/);
  });

  describe('unknownFloatKeys', () => {
    // How a stale registry gets noticed instead of quietly writing an integer.
    it('reports a fractional value on an unregistered key', () => {
      const unknownFloatKeys = new Set<string>();
      serialiseConsoleDocument({ newParameter: 0.25 }, { unknownFloatKeys });
      expect([...unknownFloatKeys]).toEqual(['newParameter']);
    });

    it('stays empty for a registered float', () => {
      const unknownFloatKeys = new Set<string>();
      serialiseConsoleDocument({ volume: -3.5 }, { unknownFloatKeys });
      expect(unknownFloatKeys.size).toBe(0);
    });

    it('stays empty for an integral value on an unregistered key', () => {
      const unknownFloatKeys = new Set<string>();
      serialiseConsoleDocument({ newFlag: 1 }, { unknownFloatKeys });
      expect(unknownFloatKeys.size).toBe(0);
    });
  });

  describe('the float registry', () => {
    // Guards the fields the backup feature exists to carry: if one of these
    // stopped being treated as a float, a restored board would be subtly wrong
    // in a way no JSON comparison would catch.
    it.each(['volume', 'preampgain', 'pan', 'stereopan', 'hpf', 'threshold', 'ratio', 'gain', 'trim'])(
      'includes %s',
      (key) => expect(FLOAT_KEYS.has(key)).toBe(true),
    );
  });
});

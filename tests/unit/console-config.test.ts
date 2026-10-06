/**
 * The document-format helpers.
 *
 * Every expected value here was read out of a real console backup — a 16R and a
 * 32R — rather than derived from documentation, because there is none. The
 * literals are the evidence, so they are spelled out instead of computed.
 */

import {
  argbToHex,
  argbAlpha,
  hexToArgb,
  parseIconId,
  stripLabelPrefix,
  channelNumbers,
  documentChannelCounts,
  eqBandCount,
  DOCUMENT_ROOTS,
} from '../../src/shared/console-config';

describe('argbToHex', () => {
  // Observed on a working 16R: these three integers and nothing else.
  it.each([
    ['a green channel', 4283284562, '#4dbc52'],
    ['a blue channel', 4278190335, '#0000ff'],
    ['an amber channel', 4294955598, '#ffd24e'],
  ])('decodes %s', (_label, value, expected) => {
    expect(argbToHex(value)).toBe(expected);
  });

  // 0 has zero alpha and is what the console stores for "no colour chosen".
  // Returning #000000 would make an unset channel look deliberately black.
  it('treats 0 as unset rather than black', () => {
    expect(argbToHex(0)).toBeNull();
  });

  it('ignores the alpha byte when producing hex', () => {
    expect(argbToHex(0x00123456)).toBe('#123456');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '#ff0000'],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('returns null for %s', (_label, value) => {
    expect(argbToHex(value)).toBeNull();
  });

  it('handles a value above the signed 32-bit range', () => {
    // 4294955598 exceeds 2^31, so a signed shift would produce a negative
    // intermediate and the wrong hex.
    expect(argbToHex(4294955598)).toBe('#ffd24e');
  });
});

describe('argbAlpha', () => {
  it('extracts full alpha', () => {
    expect(argbAlpha(4278190335)).toBe(255);
  });

  it('reports zero alpha for an unset colour', () => {
    expect(argbAlpha(0)).toBe(0);
  });

  it('returns null for a non-number', () => {
    expect(argbAlpha('x')).toBeNull();
  });
});

describe('hexToArgb', () => {
  it('round-trips the observed colours', () => {
    for (const value of [4283284562, 4278190335, 4294955598]) {
      expect(hexToArgb(argbToHex(value) as string)).toBe(value);
    }
  });

  it('defaults alpha to opaque', () => {
    // An alpha of 0 would read back as "unset", so #rrggbb must not produce it.
    expect(hexToArgb('#0000ff')).toBe(4278190335);
    expect(argbAlpha(hexToArgb('#0000ff'))).toBe(255);
  });

  it('accepts shorthand', () => {
    expect(hexToArgb('#f00')).toBe(hexToArgb('#ff0000'));
  });

  it('accepts an explicit alpha', () => {
    expect(hexToArgb('#80123456')).toBe(0x80123456);
  });

  it('accepts a value without the leading hash', () => {
    expect(hexToArgb('0000ff')).toBe(4278190335);
  });

  it.each([
    ['empty', ''],
    ['too short', '#ff'],
    ['too long', '#1234567890'],
    ['non-hex', '#gggggg'],
    ['a number', 0xff0000],
  ])('returns null for %s input', (_label, value) => {
    expect(hexToArgb(value)).toBeNull();
  });
});

describe('parseIconId', () => {
  // Real iconids are two-level paths, which means they can be matched exactly
  // rather than by keyword as the renderer currently does.
  it.each([
    ['keyboards/piano', 'keyboards', 'piano'],
    ['guitars/electric2', 'guitars', 'electric2'],
    ['drums/drumpad', 'drums', 'drumpad'],
    ['other/iem', 'other', 'iem'],
    ['other/computer', 'other', 'computer'],
  ])('splits %s', (iconid, category, name) => {
    expect(parseIconId(iconid)).toEqual({ category, name });
  });

  // The live protocol also delivers bare ids, so both shapes must parse.
  it('treats a bare id as a name with no category', () => {
    expect(parseIconId('piano')).toEqual({ category: '', name: 'piano' });
  });

  it('returns null for the empty string the console uses when unset', () => {
    expect(parseIconId('')).toBeNull();
    expect(parseIconId('   ')).toBeNull();
  });

  it('does not split on a leading or trailing slash', () => {
    expect(parseIconId('/piano')).toEqual({ category: '', name: '/piano' });
    expect(parseIconId('keyboards/')).toEqual({ category: '', name: 'keyboards/' });
  });

  it('keeps later slashes in the name', () => {
    expect(parseIconId('a/b/c')).toEqual({ category: 'a', name: 'b/c' });
  });

  it('returns null for a non-string', () => {
    expect(parseIconId(null)).toBeNull();
  });
});

describe('stripLabelPrefix', () => {
  // Aux labels arrive as `1:Ear-ALL` on a real console.
  it.each([
    ['1:Ear-ALL', 'Ear-ALL'],
    ['2:Ear-Bass', 'Ear-Bass'],
    ['16:Walkie', 'Walkie'],
  ])('strips the index prefix from %s', (input, expected) => {
    expect(stripLabelPrefix(input)).toBe(expected);
  });

  it('leaves a label without a prefix alone', () => {
    expect(stripLabelPrefix('Piano')).toBe('Piano');
  });

  it('keeps a colon that is not an index prefix', () => {
    expect(stripLabelPrefix('FOH: Main')).toBe('FOH: Main');
  });

  it('trims surrounding whitespace', () => {
    expect(stripLabelPrefix('  Piano  ')).toBe('Piano');
  });

  it('returns null when nothing is left', () => {
    expect(stripLabelPrefix('')).toBeNull();
    expect(stripLabelPrefix('3:')).toBeNull();
    expect(stripLabelPrefix(null)).toBeNull();
  });
});

describe('channelNumbers', () => {
  it('returns channel numbers in ascending numeric order', () => {
    // Object key order would put ch10 before ch2 if sorted as strings.
    const collection = { ch10: {}, ch2: {}, ch1: {} };
    expect(channelNumbers(collection)).toEqual([1, 2, 10]);
  });

  it('ignores keys that are not channels', () => {
    expect(channelNumbers({ ch1: {}, username: 'x', chAll: {} })).toEqual([1]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'ch1'],
  ])('returns an empty array for %s', (_label, value) => {
    expect(channelNumbers(value)).toEqual([]);
  });
});

describe('documentChannelCounts', () => {
  // These are the real per-model shapes, and the reason nothing may assume 8
  // DCAs: the 32R has 24.
  it('reports the 16R shape', () => {
    const doc = {
      line: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`ch${i + 1}`, {}])),
      aux: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`ch${i + 1}`, {}])),
      filtergroup: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`ch${i + 1}`, {}])),
    };
    expect(documentChannelCounts(doc)).toEqual({ line: 16, aux: 6, filtergroup: 8 });
  });

  it('reports the 32R shape, including its 24 DCAs and 4 subs', () => {
    const doc = {
      line: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`ch${i + 1}`, {}])),
      aux: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`ch${i + 1}`, {}])),
      sub: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`ch${i + 1}`, {}])),
      filtergroup: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`ch${i + 1}`, {}])),
    };
    expect(documentChannelCounts(doc)).toEqual({
      line: 32, aux: 16, sub: 4, filtergroup: 24,
    });
  });

  it('omits roots that are absent, so a 16R reports no subs at all', () => {
    expect(documentChannelCounts({ line: { ch1: {} } })).toEqual({ line: 1 });
  });

  it('ignores non-channel roots', () => {
    const counts = documentChannelCounts({ global: { samplerate: 1 }, line: { ch1: {} } });
    expect(counts).toEqual({ line: 1 });
  });
});

describe('eqBandCount', () => {
  // Band count is channel-type dependent: line has 4, aux has 6. Anything
  // iterating bands must read it rather than assume.
  it('counts a 4-band line EQ', () => {
    const eq = {
      eqallon: 1,
      eqfreq1: 130, eqfreq2: 500, eqfreq3: 2000, eqfreq4: 5000,
      eqgain1: 0, eqbandop1: 0,
    };
    expect(eqBandCount(eq)).toBe(4);
  });

  it('counts a 6-band aux EQ', () => {
    const eq = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`eqfreq${i + 1}`, 100 * (i + 1)]),
    );
    expect(eqBandCount(eq)).toBe(6);
  });

  it('does not count eqbandop or eqgain keys', () => {
    expect(eqBandCount({ eqgain1: 0, eqbandop1: 0, eqbandon1: 1 })).toBe(0);
  });

  it.each([
    ['null', null],
    ['a number', 4],
  ])('returns 0 for %s', (_label, value) => {
    expect(eqBandCount(value)).toBe(0);
  });
});

describe('DOCUMENT_ROOTS', () => {
  // The scope difference is the operationally important fact about these
  // documents: a scene alone is not a complete capture.
  it('places global only in a project config', () => {
    expect(DOCUMENT_ROOTS.cnfg).toContain('global');
    expect(DOCUMENT_ROOTS.scene).not.toContain('global');
    expect(DOCUMENT_ROOTS.scn).not.toContain('global');
  });

  it('gives a channel preset processing only', () => {
    expect([...DOCUMENT_ROOTS.channel].sort())
      .toEqual(['comp', 'eq', 'filter', 'gate', 'limit']);
  });

  // This is the mechanism behind hardware matrix row C8: recalling a channel
  // preset cannot change a label, colour, gain or phantom because none of them
  // are in the file.
  it.each(['username', 'color', 'iconid', 'preampgain', '48v', 'polarity'])(
    'excludes %s from a channel preset',
    (field) => {
      expect(DOCUMENT_ROOTS.channel).not.toContain(field);
    },
  );
});

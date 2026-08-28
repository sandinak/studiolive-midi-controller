/**
 * The channel menu puts the console presets matching a channel's instrument at
 * the top of the list. That match comes from the channel's icon id, which is a
 * free-form string the console publishes no vocabulary for — it arrives both as
 * `keyboards/piano` and as a bare `piano` — so the mapping is keyword-based and
 * order-sensitive. These pin the orderings that are easy to break.
 */

import * as fs from 'fs';
import * as path from 'path';

const HTML = fs.readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.html'),
  'utf-8',
);

/** Pull the keyword table and the matcher out of the renderer and run them. */
function loadMatcher(): (iconId: string | null) => string | null {
  const table = HTML.match(
    /const PRESET_CATEGORY_KEYWORDS = \[[\s\S]*?\n {4}\];/
  );
  const fn = HTML.match(
    /function presetCategoryForIcon\(iconId\) \{[\s\S]*?\n {4}\}/
  );
  if (!table || !fn) throw new Error('Could not extract the preset category matcher');
  // eslint-disable-next-line no-new-func
  return new Function(`${table[0]}\n${fn[0]}\nreturn presetCategoryForIcon;`)() as any;
}

const categoryFor = loadMatcher();

describe('presetCategoryForIcon', () => {
  it('matches the two-level ids a console reports', () => {
    expect(categoryFor('keyboards/piano')).toBe('Keys');
    expect(categoryFor('guitars/bass')).toBe('Guit');
    expect(categoryFor('drums/drumpad')).toBe('Drum');
    expect(categoryFor('guitars/amp(smallcombo)')).toBe('Guit');
  });

  it('matches bare ids too', () => {
    expect(categoryFor('leadvocals')).toBe('Vocal');
    expect(categoryFor('kickin')).toBe('Drum');
    expect(categoryFor('electricguitar')).toBe('Guit');
  });

  // The orderings that are easy to get wrong.
  it('treats steeldrum as percussion, not a drum kit piece', () => {
    expect(categoryFor('steeldrum')).toBe('Perc');
    expect(categoryFor('orchestrdrum')).toBe('Perc');
  });

  it('treats bassoon and bass clarinet as woodwind, not bass guitar', () => {
    expect(categoryFor('bassoon')).toBe('Wind');
    expect(categoryFor('bassclarinet')).toBe('Wind');
  });

  it('still treats an upright bass as a guitar-family preset', () => {
    expect(categoryFor('uprightbass')).toBe('Guit');
    expect(categoryFor('guitars/bass')).toBe('Guit');
  });

  it('is case and separator insensitive', () => {
    expect(categoryFor('Drums/Kick_In')).toBe('Drum');
    expect(categoryFor('KEYBOARDS/PIANO')).toBe('Keys');
  });

  it('returns null for an unknown or missing icon', () => {
    // ch16 on the test console has no icon set at all.
    expect(categoryFor(null)).toBeNull();
    expect(categoryFor('')).toBeNull();
    expect(categoryFor('other/computer')).toBeNull();
    expect(categoryFor('other/metronome')).toBeNull();
  });

  it('only produces categories the console actually uses', () => {
    const known = ['Drum', 'Guit', 'Vocal', 'Keys', 'Perc', 'Brass', 'Wind'];
    for (const icon of [
      'keyboards/piano', 'guitars/bass', 'drums/kickin', 'vocals/leadvocals',
      'congas', 'trumpet', 'sax', 'other/headphones',
    ]) {
      const category = categoryFor(icon);
      if (category !== null) expect(known).toContain(category);
    }
  });
});

import * as path from 'path';
import { slugifyPresetName, presetPathFor, isWithinDirectory } from '../../src/main/preset-paths';

const DIR = path.join(path.sep, 'home', 'user', 'profiles');

describe('slugifyPresetName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyPresetName('Sunday Service')).toBe('sunday-service');
  });

  it('collapses runs of whitespace into a single hyphen', () => {
    expect(slugifyPresetName('Main   Room')).toBe('main-room');
  });

  it('keeps digits, hyphens and underscores', () => {
    expect(slugifyPresetName('stage_2-mix')).toBe('stage_2-mix');
  });

  it('trims surrounding whitespace', () => {
    expect(slugifyPresetName('  padded  ')).toBe('padded');
  });

  it('strips leading and trailing separators', () => {
    expect(slugifyPresetName('--weird--')).toBe('weird');
  });

  // ---- Path traversal ----
  // `path.join(dir, name + '.json')` escapes `dir` whenever the name carries
  // separators or `..`, so none of those may survive slugification.
  describe('path traversal', () => {
    it.each([
      ['parent segments', '../../../etc/passwd'],
      ['a leading slash', '/etc/passwd'],
      ['a Windows path', 'C:\\Windows\\System32\\config'],
      ['backslash segments', '..\\..\\secrets'],
      ['a bare dot-dot', '..'],
      ['a single dot', '.'],
      ['a null byte', 'evil\0.json'],
      ['a URL', 'http://evil.example/x'],
    ])('neutralises %s', (_label, name) => {
      const slug = slugifyPresetName(name);
      if (slug !== null) {
        expect(slug).not.toContain('/');
        expect(slug).not.toContain('\\');
        expect(slug).not.toContain('.');
        expect(slug).not.toContain('\0');
      }
    });

    it('keeps a traversal attempt inside the profiles directory', () => {
      const p = presetPathFor(DIR, '../../../etc/passwd');
      // Either rejected outright, or resolved safely inside DIR.
      if (p !== null) {
        expect(isWithinDirectory(DIR, p)).toBe(true);
      }
    });

    it('keeps an absolute-path attempt inside the profiles directory', () => {
      const p = presetPathFor(DIR, '/etc/cron.d/evil');
      if (p !== null) {
        expect(isWithinDirectory(DIR, p)).toBe(true);
      }
    });
  });

  describe('returns null when nothing usable remains', () => {
    it.each([
      ['an empty string', ''],
      ['only whitespace', '   '],
      ['only punctuation', '!!!'],
      ['only dots', '...'],
      ['only slashes', '///'],
    ])('%s', (_label, name) => {
      expect(slugifyPresetName(name)).toBeNull();
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 7],
      ['an object', {}],
    ])('for non-string input: %s', (_label, value) => {
      expect(slugifyPresetName(value)).toBeNull();
    });
  });

  it('caps an absurdly long name', () => {
    const slug = slugifyPresetName('a'.repeat(5000));
    expect(slug!.length).toBeLessThanOrEqual(200);
  });
});

describe('presetPathFor', () => {
  it('builds a .json path inside the directory', () => {
    expect(presetPathFor(DIR, 'My Preset')).toBe(path.join(DIR, 'my-preset.json'));
  });

  it('returns null for an unusable name', () => {
    expect(presetPathFor(DIR, '///')).toBeNull();
  });

  it('always lands inside the directory', () => {
    for (const name of ['ok', '../escape', '/abs', 'a b c', 'UPPER']) {
      const p = presetPathFor(DIR, name);
      if (p !== null) expect(isWithinDirectory(DIR, p)).toBe(true);
    }
  });
});

describe('isWithinDirectory', () => {
  it('accepts a direct child', () => {
    expect(isWithinDirectory(DIR, path.join(DIR, 'a.json'))).toBe(true);
  });

  it('accepts a nested descendant', () => {
    expect(isWithinDirectory(DIR, path.join(DIR, 'sub', 'a.json'))).toBe(true);
  });

  it('accepts the directory itself', () => {
    expect(isWithinDirectory(DIR, DIR)).toBe(true);
  });

  it('resolves .. segments before comparing', () => {
    expect(isWithinDirectory(DIR, path.join(DIR, '..', 'elsewhere.json'))).toBe(false);
  });

  it('rejects a sibling directory that shares a name prefix', () => {
    // A naive startsWith without the separator would accept this.
    expect(isWithinDirectory(DIR, DIR + '-evil' + path.sep + 'a.json')).toBe(false);
  });

  it('rejects an unrelated absolute path', () => {
    expect(isWithinDirectory(DIR, path.join(path.sep, 'etc', 'passwd'))).toBe(false);
  });

  it('tolerates a trailing separator on the directory', () => {
    expect(isWithinDirectory(DIR + path.sep, path.join(DIR, 'a.json'))).toBe(true);
  });
});

import { isSafeExternalUrl } from '../../src/shared/url-safety';

describe('isSafeExternalUrl', () => {
  describe('allows ordinary web links', () => {
    it.each([
      'https://example.com',
      'https://sandinak.github.io/studiolive-midi-controller/',
      'http://192.168.1.10:8080/path?q=1#frag',
      'https://example.com/a/b/c.html',
      'mailto:someone@example.com',
    ])('%s', (url) => {
      expect(isSafeExternalUrl(url)).toBe(true);
    });
  });

  // openExternal defers to the OS handler, so the scheme decides what runs.
  describe('blocks schemes that reach the OS handler', () => {
    it.each([
      ['file — reads local paths', 'file:///etc/passwd'],
      ['file with a UNC path', 'file://server/share/x'],
      ['javascript', 'javascript:alert(1)'],
      ['data', 'data:text/html,<script>alert(1)</script>'],
      ['vbscript', 'vbscript:msgbox(1)'],
      ['smb', 'smb://attacker/share'],
      ['a custom app scheme', 'zoommtg://zoom.us/join?confno=1'],
      ['ms-msdt', 'ms-msdt:/id'],
      ['about', 'about:blank'],
      ['chrome', 'chrome://settings'],
    ])('%s', (_label, url) => {
      expect(isSafeExternalUrl(url)).toBe(false);
    });

    it('blocks a scheme differing only in case', () => {
      // URL normalises the protocol to lowercase, so this must not sneak past.
      expect(isSafeExternalUrl('FILE:///etc/passwd')).toBe(false);
      expect(isSafeExternalUrl('JaVaScRiPt:alert(1)')).toBe(false);
    });

    it('blocks a scheme padded with leading whitespace', () => {
      expect(isSafeExternalUrl('  javascript:alert(1)')).toBe(false);
    });
  });

  describe('blocks input with no usable scheme', () => {
    it.each([
      ['an empty string', ''],
      ['a relative path', '/docs/index.html'],
      ['a bare host', 'example.com'],
      ['a protocol-relative URL', '//example.com'],
      ['whitespace', '   '],
      ['a plain sentence', 'not a url at all'],
    ])('%s', (_label, url) => {
      expect(isSafeExternalUrl(url)).toBe(false);
    });
  });

  describe('blocks non-string input', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['an object', { toString: () => 'https://example.com' }],
      ['an array', ['https://example.com']],
    ])('%s', (_label, value) => {
      expect(isSafeExternalUrl(value)).toBe(false);
    });
  });

  it('rejects an implausibly long URL', () => {
    expect(isSafeExternalUrl('https://example.com/' + 'a'.repeat(4000))).toBe(false);
  });

  it('accepts a URL just under the length cap', () => {
    const url = 'https://example.com/' + 'a'.repeat(2000);
    expect(url.length).toBeLessThanOrEqual(2048);
    expect(isSafeExternalUrl(url)).toBe(true);
  });
});

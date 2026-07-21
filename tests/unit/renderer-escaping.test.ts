/**
 * Guards the renderer's HTML escaping.
 *
 * The renderer is a single 8k-line HTML file with inline script, so it can't
 * be imported. These tests extract its script block, evaluate the sanitizer
 * out of it, and assert on the source text for the wiring — enough to catch
 * the two failure modes that actually happened: a sanitizer that exists but
 * is never called, and an untrusted value interpolated raw into innerHTML.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const HTML = fs.readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.html'),
  'utf-8',
);

/** The renderer's single inline <script> body. */
const SCRIPT = (() => {
  const blocks = [...HTML.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
  expect(blocks.length).toBeGreaterThan(0);
  return blocks.map(b => b[1]).join('\n');
})();

/** Pull sanitizeHtml out of the renderer source and make it callable. */
function loadSanitizer(): (s: unknown) => string {
  const match = SCRIPT.match(/function sanitizeHtml\s*\([\s\S]*?\n {4}\}/);
  if (!match) throw new Error('sanitizeHtml not found in renderer source');
  const context: any = {};
  vm.createContext(context);
  vm.runInContext(`${match[0]}; this.fn = sanitizeHtml;`, context);
  return context.fn;
}

describe('renderer sanitizeHtml', () => {
  const sanitizeHtml = loadSanitizer();

  it('escapes angle brackets', () => {
    expect(sanitizeHtml('<b>')).toBe('&lt;b&gt;');
  });

  it('escapes ampersands first so entities are not double-decoded', () => {
    expect(sanitizeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('escapes both quote styles', () => {
    expect(sanitizeHtml(`"'`)).toBe('&quot;&#x27;');
  });

  it('neutralises a script payload in a mixer channel name', () => {
    const out = sanitizeHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('neutralises an attribute-breakout payload', () => {
    // The shape that matters for `style="${...}"` and `title="${...}"`.
    const out = sanitizeHtml('" onmouseover="alert(1)');
    expect(out).not.toContain('"');
  });

  it('returns empty string for null and undefined', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('coerces non-strings', () => {
    expect(sanitizeHtml(42)).toBe('42');
  });

  it('matches the shared main-process implementation', () => {
    // src/shared/sanitize.ts is the same routine; if one is changed the
    // other should follow.
    const { sanitizeHtml: shared } = require('../../src/shared/sanitize');
    for (const input of ['<a>', '&', `"'`, 'plain', '', null, 5]) {
      expect(sanitizeHtml(input)).toBe(shared(input));
    }
  });
});

describe('renderer escaping is actually wired up', () => {
  // The regression this pins: sanitizeHtml was defined in the renderer and
  // never called once, while ~30 innerHTML sites interpolated mixer- and
  // preset-supplied values raw.
  it('calls sanitizeHtml, not merely define it', () => {
    const calls = SCRIPT.match(/sanitizeHtml\(/g) ?? [];
    // One match is the function declaration itself.
    expect(calls.length).toBeGreaterThan(5);
  });

  it('escapes the mixer-supplied channel name in renderFader', () => {
    expect(SCRIPT).toMatch(
      /const channelName = sanitizeHtml\(channelInfo \? channelInfo\.name/,
    );
  });

  it('escapes the channel name in the mappings list', () => {
    expect(SCRIPT).toMatch(/const mixerDesc = sanitizeHtml\(/);
  });

  it('escapes MIDI device names in the device list', () => {
    expect(SCRIPT).toMatch(/const safeDevice = sanitizeHtml\(device\)/);
  });

  it('escapes DCA member names in the tooltip', () => {
    expect(SCRIPT).toMatch(/const memberTitle = sanitizeHtml\(/);
  });

  it('escapes colour values before they reach style attributes', () => {
    expect(SCRIPT).toMatch(/const labelStyle = sanitizeHtml\(/);
  });

  it('no longer builds inline onclick handlers from MIDI device names', () => {
    // These nested a JS string literal inside an HTML attribute, which no
    // single escaping pass can make safe; they are event listeners now.
    expect(SCRIPT).not.toMatch(/onclick="connectToMidiDevice\('/);
    expect(SCRIPT).not.toMatch(/onclick="disconnectMidiDevice\('/);
  });
});

/**
 * Keeps the in-app help consistent with the app.
 *
 * The help tab bar and the helpSections map are declared ~400 lines apart in
 * the renderer, so a tab added without a matching body silently renders an
 * empty panel. These also pin the facts users act on — ports, paths — which
 * had drifted from the code.
 */

import * as fs from 'fs';
import * as path from 'path';

const HTML = fs.readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.html'),
  'utf-8',
);

/** Section keys declared in the helpSections map. */
const sectionKeys = [...HTML.matchAll(/^ {6}'([a-z-]+)': `/gm)].map(m => m[1]);

/** Section keys referenced by the help tab buttons. */
const tabKeys = [...new Set(
  [...HTML.matchAll(/showHelpSection\('([a-z-]+)'\)/g)].map(m => m[1]),
)];

describe('in-app help wiring', () => {
  it('declares help sections', () => {
    expect(sectionKeys.length).toBeGreaterThan(0);
  });

  it.each(tabKeys)('tab "%s" has a section body', (key) => {
    expect(sectionKeys).toContain(key);
  });

  it('has no orphaned section that no tab reaches', () => {
    const orphans = sectionKeys.filter(k => !tabKeys.includes(k));
    expect(orphans).toEqual([]);
  });

  it('covers the features shipped since 1.2.4', () => {
    // Each of these was live in the app but documented nowhere.
    const body = HTML;
    for (const topic of ['TUIO', 'Fader Stacking', 'DCA Colors', 'Run Mode', 'Transport']) {
      expect(body).toContain(topic);
    }
  });
});

describe('in-app help states the correct network facts', () => {
  // 53000 is the TCP control port; 47809 is the UDP discovery port. The
  // troubleshooting section used to tell users to open "UDP port 53000",
  // which is neither.
  it('does not describe 53000 as a UDP port', () => {
    expect(HTML).not.toMatch(/UDP port 53000/i);
    expect(HTML).not.toMatch(/UDP\s*53000/i);
  });

  it('names the TCP control port', () => {
    expect(HTML).toMatch(/TCP port 53000/i);
  });

  it('names the UDP discovery port', () => {
    expect(HTML).toMatch(/UDP port 47809/i);
  });

  it('names the TUIO listen port', () => {
    expect(HTML).toMatch(/UDP port 3333/i);
  });

  it('gives the real macOS preset directory', () => {
    // getProfilesDir() joins appData with this exact folder name.
    expect(HTML).toContain('Application Support/StudioLive Midi Controller');
  });
});

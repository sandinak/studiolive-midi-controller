/**
 * Keeps the documentation honest about things the code decides.
 *
 * Every assertion here corresponds to a claim that had actually drifted:
 * a wrong preset directory, 53000 described as UDP, a version badge and
 * artifact listing left behind by releases, and six shipped features that
 * appeared in no document at all.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

const README = read('README.md');
const USAGE = read('docs/usage.md');
const SETUP = read('docs/setup.md');
const BUILDING = read('docs/building.md');
const SITE = read('docs/index.html');
const INDEX_TS = read('src/main/index.ts');
const PKG = JSON.parse(read('package.json'));

/** Every prose document, for claims that must not appear anywhere. */
const ALL_DOCS: Array<[string, string]> = [
  ['README.md', README],
  ['docs/usage.md', USAGE],
  ['docs/setup.md', SETUP],
  ['docs/building.md', BUILDING],
  ['docs/index.html', SITE],
];

describe('network facts match the code', () => {
  // 53000 is the TCP control port (SimpleClient host/port, and the sweep's
  // probeTcp target); 47809 is the UDP discovery broadcast port.
  it.each(ALL_DOCS)('%s does not call 53000 a UDP port', (_name, body) => {
    expect(body).not.toMatch(/UDP[^.\n]{0,20}53000/i);
    expect(body).not.toMatch(/53000[^.\n]{0,20}\bUDP\b/i);
  });

  it('the code really uses TCP 53000', () => {
    expect(INDEX_TS).toContain('53000');
  });

  it('usage and site docs name the UDP discovery port', () => {
    expect(USAGE).toMatch(/47809/);
    expect(SITE).toMatch(/47809/);
  });

  it('the TUIO port documented matches the default in tuio-manager', () => {
    const tuio = read('src/main/tuio-manager.ts');
    const defaultPort = tuio.match(/constructor\(port = (\d+)\)/)?.[1];
    expect(defaultPort).toBe('3333');
    expect(USAGE).toContain(`UDP port ${defaultPort}`);
    expect(SITE).toContain(`UDP port ${defaultPort}`);
  });
});

describe('preset directory matches getProfilesDir()', () => {
  // getProfilesDir() joins appData with this literal folder name.
  const folder = INDEX_TS.match(/appData'\), '([^']+)'\)/)?.[1];

  it('is discoverable in the source', () => {
    expect(folder).toBe('StudioLive Midi Controller');
  });

  it.each([['docs/usage.md', USAGE], ['docs/index.html', SITE]])(
    '%s documents the real folder name', (_name, body) => {
      expect(body).toContain(`Application Support/${folder}`);
    },
  );

  it('no document still points at the old lowercase presets/ path', () => {
    for (const [, body] of ALL_DOCS) {
      expect(body).not.toContain('studiolive-midi-controller/presets');
    }
  });
});

describe('version references', () => {
  it('the README badge matches package.json', () => {
    const badge = README.match(/badge\/version-([\d.]+)-blue/)?.[1];
    expect(badge).toBe(PKG.version);
  });

  it('building.md uses a placeholder rather than a pinned version', () => {
    // The artifact listing was left at 1.2.2 across five releases.
    const listing = BUILDING.match(/```\n(release\/[\s\S]*?)```/)?.[1] ?? '';
    expect(listing).toContain('<version>');
    expect(listing).not.toMatch(/\d+\.\d+\.\d+/);
  });
});

describe('shipped features are documented', () => {
  // Each of these was live in the app but present in no document.
  const FEATURES: Array<[string, RegExp]> = [
    ['TUIO multi-touch', /TUIO/],
    ['Run mode', /Run [Mm]ode/],
    ['transport control', /[Tt]ransport/],
    ['fader stacking', /[Ff]ader [Ss]tacking/],
    ['per-mixer presets', /serial number/i],
    ['DCA colors', /DCA [Cc]olou?rs?/],
  ];

  it.each(FEATURES)('usage.md covers %s', (_label, pattern) => {
    expect(USAGE).toMatch(pattern);
  });

  it.each(FEATURES)('the docs site covers %s', (_label, pattern) => {
    expect(SITE).toMatch(pattern);
  });
});

describe('build prerequisites match CI', () => {
  const ci = read('.github/workflows/ci.yml');
  const nodeVersion = ci.match(/node-version: '(\d+)'/)?.[1];
  const pyVersion = ci.match(/python-version: '([\d.]+)'/)?.[1];

  it('CI pins a Node and Python version', () => {
    expect(nodeVersion).toBeTruthy();
    expect(pyVersion).toBeTruthy();
  });

  it.each([['docs/setup.md', SETUP], ['docs/building.md', BUILDING]])(
    '%s documents the Node version CI builds with', (_name, body) => {
      expect(body).toContain(`Node.js ${nodeVersion}+`);
    },
  );

  it.each([['docs/setup.md', SETUP], ['docs/building.md', BUILDING]])(
    '%s documents the Python version CI builds with', (_name, body) => {
      expect(body).toContain(`Python ${pyVersion}`);
    },
  );
});

describe('repository files the docs reference', () => {
  it('LICENSE exists, since the README links to it', () => {
    expect(README).toMatch(/\[LICENSE\]\(LICENSE\)/);
    expect(fs.existsSync(path.join(ROOT, 'LICENSE'))).toBe(true);
  });

  it('the LICENSE is the MIT text package.json declares', () => {
    expect(PKG.license).toBe('MIT');
    expect(read('LICENSE')).toContain('MIT License');
  });

  it.each(['docs/setup.md', 'docs/usage.md', 'docs/building.md', 'CHANGELOG.md'])(
    'README link target %s exists', (target) => {
      expect(fs.existsSync(path.join(ROOT, target))).toBe(true);
    },
  );
});

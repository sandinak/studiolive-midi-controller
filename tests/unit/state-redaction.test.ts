/**
 * Redaction is the only thing standing between a diagnostic dump and a
 * console's serial number, network configuration and remote-access code
 * appearing in a public bug report. A rule that silently fails to match leaks,
 * so each one is pinned individually, and the glob matcher is tested on its own
 * rather than only through the redactor.
 */

import {
  redactStateDump,
  pathMatchesGlob,
  logicalPath,
  REDACTED,
  REDACTED_ROOTS,
  REDACTED_PATHS,
  ANONYMISED_PATHS,
} from '../../src/shared/state-redaction';

describe('pathMatchesGlob', () => {
  it('matches an exact path', () => {
    expect(pathMatchesGlob('global/mixer_serial', 'global/mixer_serial')).toBe(true);
  });

  it('requires the whole path to match, not a prefix', () => {
    expect(pathMatchesGlob('global/mixer_serial/extra', 'global/mixer_serial')).toBe(false);
    expect(pathMatchesGlob('global', 'global/mixer_serial')).toBe(false);
  });

  describe('single-segment wildcard', () => {
    it('matches one segment', () => {
      expect(pathMatchesGlob('filtergroup/ch1/name', 'filtergroup/*/name')).toBe(true);
    });

    it('does not span a separator', () => {
      expect(pathMatchesGlob('filtergroup/ch1/sub/name', 'filtergroup/*/name')).toBe(false);
    });
  });

  describe('multi-segment wildcard', () => {
    it('matches at any depth', () => {
      expect(pathMatchesGlob('line/ch1/username', '**/username')).toBe(true);
      expect(pathMatchesGlob('internal/aux/ch16/username', '**/username')).toBe(true);
    });

    it('matches zero segments', () => {
      expect(pathMatchesGlob('username', '**/username')).toBe(true);
    });

    it('still requires the trailing segment', () => {
      expect(pathMatchesGlob('line/ch1/name', '**/username')).toBe(false);
    });
  });

  describe('wildcard within a segment', () => {
    // This is what catches mutegroup1username through mutegroup8username
    // without enumerating eight rules.
    it.each([1, 4, 8])('matches mutegroup%dusername', (n) => {
      expect(pathMatchesGlob(`mutegroup/mutegroup${n}username`, 'mutegroup/*username')).toBe(true);
    });

    it('does not match a different suffix in the same segment', () => {
      expect(pathMatchesGlob('mutegroup/mutegroup1mutes', 'mutegroup/*username')).toBe(false);
    });
  });

  it('treats a regex metacharacter in a glob literally', () => {
    expect(pathMatchesGlob('global/a.b', 'global/a.b')).toBe(true);
    expect(pathMatchesGlob('global/axb', 'global/a.b')).toBe(false);
  });
});

describe('redactStateDump', () => {
  /** A dump shaped like `Client.dumpState()`, with the sensitive parts filled in. */
  const dump = () => ({
    internal: {
      global: {
        mixer_serial: 'RA1E24090034',
        registered_user: 'Jane Smith',
        devicename: 'Stage Rack',
        mixer_name: 'Main Console',
        mixer_version: '3.4.0.111374',
        samplerate: 1,
      },
      permissions: { access_code: 's3cret', preamps: 1 },
      networksetup: { ipaddress: '192.168.1.50', subnet: '255.255.255.0' },
      users: { user1: { name: 'Jane' } },
      sdrecorder: {
        session: { artist: 'The Band', location: 'Village Hall', path: '/x' },
        sdcard: { volume_label: 'SHOW-SD', card_mounted: 1 },
      },
      presets: { loaded_scene_name: 'Sunday AM', diskusage: 12 },
      line: {
        ch1: { username: 'Vocal - Dana', color: 4278190335, iconid: 'vocals/mic', volume: -3.2 },
      },
      filtergroup: { ch1: { name: 'Drums', volume: 0 } },
      mutegroup: { mutegroup1username: 'Band', mutegroup1mutes: '1,2,3' },
    },
    cache: { global: { mixer_serial: 'RA1E24090034' } },
  });

  it('does not mutate the input', () => {
    const original = dump();
    redactStateDump(original);
    expect(original.internal.global.mixer_serial).toBe('RA1E24090034');
    expect(original.internal.permissions).toBeDefined();
  });

  describe('secrets, redacted unconditionally', () => {
    // No option gates these. A caller cannot forget to pass a flag and leak.
    it.each(REDACTED_ROOTS)('removes the %s root entirely', (root) => {
      const { dump: out } = redactStateDump(dump());
      expect((out.internal as Record<string, unknown>)[root]).toBeUndefined();
    });

    it('removes the access code with its whole root', () => {
      const serialised = JSON.stringify(redactStateDump(dump()).dump);
      expect(serialised).not.toContain('s3cret');
      expect(serialised).not.toContain('access_code');
    });

    it.each([
      ['the serial', 'RA1E24090034'],
      ['the registered user', 'Jane Smith'],
      ['the device name', 'Stage Rack'],
      ['the mixer name', 'Main Console'],
      ['the IP address', '192.168.1.50'],
      ['session metadata', 'Village Hall'],
      ['the SD card label', 'SHOW-SD'],
    ])('removes %s', (_label, secret) => {
      expect(JSON.stringify(redactStateDump(dump()).dump)).not.toContain(secret);
    });

    // A sensitive root appears twice in dumpState()'s output, under `internal`
    // and under `cache`. Anchoring the rule at depth 0 would have missed both.
    it('redacts a nested copy of the same data', () => {
      const { dump: out } = redactStateDump(dump());
      const cache = out.cache as { global: Record<string, unknown> };
      expect(cache.global.mixer_serial).toBe(REDACTED);
    });

    it('keeps the key so the parameter is still known to exist', () => {
      const { dump: out } = redactStateDump(dump());
      const global = (out.internal as { global: Record<string, unknown> }).global;
      expect(global).toHaveProperty('mixer_serial', REDACTED);
    });

    it('keeps firmware version, which is diagnostically essential', () => {
      const { dump: out } = redactStateDump(dump());
      const global = (out.internal as { global: Record<string, unknown> }).global;
      expect(global.mixer_version).toBe('3.4.0.111374');
      expect(global.samplerate).toBe(1);
    });
  });

  describe('operator text, kept by default', () => {
    // Debugging your own console is the common case, and labels are most of
    // what makes a dump legible.
    it('keeps channel labels', () => {
      const { dump: out } = redactStateDump(dump());
      const line = (out.internal as { line: Record<string, Record<string, unknown>> }).line;
      expect(line.ch1.username).toBe('Vocal - Dana');
    });

    it('keeps DCA and mute group names', () => {
      const { dump: out } = redactStateDump(dump());
      const internal = out.internal as Record<string, Record<string, Record<string, unknown>>>;
      expect(internal.filtergroup.ch1.name).toBe('Drums');
      expect(internal.mutegroup.mutegroup1username).toBe('Band');
    });
  });

  describe('anonymise', () => {
    // Required before a dump is committed as a fixture or attached to a public
    // issue: channel labels on a real board name the people behind them.
    it('removes channel labels', () => {
      const { dump: out } = redactStateDump(dump(), { anonymise: true });
      const line = (out.internal as { line: Record<string, Record<string, unknown>> }).line;
      expect(line.ch1.username).toBe(REDACTED);
    });

    it.each([
      ['a channel label', 'Vocal - Dana'],
      ['a DCA name', 'Drums'],
      ['a mute group name', 'Band'],
      ['a loaded scene name', 'Sunday AM'],
    ])('removes %s', (_label, text) => {
      const serialised = JSON.stringify(redactStateDump(dump(), { anonymise: true }).dump);
      expect(serialised).not.toContain(text);
    });

    // Colour and icon are not identifying, and are the fields the backup work
    // exists to carry, so anonymising must not take them.
    it('keeps colour, icon and levels', () => {
      const { dump: out } = redactStateDump(dump(), { anonymise: true });
      const line = (out.internal as { line: Record<string, Record<string, unknown>> }).line;
      expect(line.ch1.color).toBe(4278190335);
      expect(line.ch1.iconid).toBe('vocals/mic');
      expect(line.ch1.volume).toBe(-3.2);
    });

    it('keeps mute group membership, which is structure not text', () => {
      const { dump: out } = redactStateDump(dump(), { anonymise: true });
      const mutegroup = (out.internal as { mutegroup: Record<string, unknown> }).mutegroup;
      expect(mutegroup.mutegroup1mutes).toBe('1,2,3');
    });
  });

  describe('report', () => {
    it('names the roots it removed', () => {
      const { report } = redactStateDump(dump());
      expect(report.removedRoots).toEqual([
        'internal/networksetup', 'internal/permissions', 'internal/users',
      ]);
    });

    it('names the paths it replaced', () => {
      const { report } = redactStateDump(dump());
      expect(report.redactedPaths).toContain('internal/global/mixer_serial');
      expect(report.redactedPaths).toContain('cache/global/mixer_serial');
    });

    it('lists anonymised paths only when anonymising', () => {
      expect(redactStateDump(dump()).report.redactedPaths)
        .not.toContain('internal/line/ch1/username');
      expect(redactStateDump(dump(), { anonymise: true }).report.redactedPaths)
        .toContain('internal/line/ch1/username');
    });

    it('deduplicates and sorts', () => {
      const { report } = redactStateDump(dump());
      expect(report.redactedPaths).toEqual([...new Set(report.redactedPaths)].sort());
    });
  });

  describe('edge cases', () => {
    it.each([
      ['null', null],
      ['a number', 42],
      ['a string', 'plain'],
      ['undefined', undefined],
    ])('passes %s through unchanged', (_label, value) => {
      expect(redactStateDump(value).dump).toEqual(value);
    });

    it('handles an empty object', () => {
      expect(redactStateDump({}).dump).toEqual({});
    });

    it('walks into arrays', () => {
      const out = redactStateDump({ list: [{ global: { mixer_serial: 'X' } }] }).dump;
      expect((out as any).list[0].global.mixer_serial).toBe(REDACTED);
    });

    it('empties a redacted object rather than stringifying it', () => {
      const out = redactStateDump({ global: { devicename: { nested: 'x' } } }).dump;
      expect((out as any).global.devicename).toEqual({});
    });

    it('leaves a dump with nothing sensitive untouched', () => {
      const clean = { internal: { line: { ch1: { volume: -3, color: 1 } } } };
      const { dump: out, report } = redactStateDump(clean);
      expect(out).toEqual(clean);
      expect(report.removedRoots).toEqual([]);
      expect(report.redactedPaths).toEqual([]);
    });
  });

  // Guards against a rule being added to the list but written so it never
  // matches — the failure mode that leaks while looking like it works. This is
  // exactly what went wrong first time round: the rules were anchored at the
  // dump root, and `dumpState()` nests the tree under `internal` and `cache`,
  // so every one of them matched nothing.
  //
  // Asserted through `redactStateDump` rather than the raw matcher, so the
  // depth-anchoring the redactor applies is part of what is under test.
  describe('every declared rule is reachable', () => {
    /** Turn `a/b/c` into `{a:{b:{c:'SENTINEL'}}}`, with `*` made concrete. */
    const nest = (glob: string): Record<string, unknown> => {
      const segments = glob
        .split('/')
        .filter((s) => s !== '**')
        .map((s) => (s === '*' ? 'ch1' : s.replace(/\*/g, 'mutegroup1')));
      let node: unknown = 'SENTINEL';
      for (const segment of segments.reverse()) node = { [segment]: node };
      return node as Record<string, unknown>;
    };

    it.each([...REDACTED_PATHS, ...ANONYMISED_PATHS])('%s redacts a real path', (glob) => {
      // Wrapped the way a real dump is, to catch anchoring mistakes.
      const { dump: out, report } = redactStateDump(
        { internal: nest(glob) },
        { anonymise: true },
      );
      expect(JSON.stringify(out)).not.toContain('SENTINEL');
      expect(report.redactedPaths.length).toBeGreaterThan(0);
    });

    it('leaves an unrelated path of the same depth alone', () => {
      const { dump: out } = redactStateDump(
        { internal: { global: { mixer_version: 'SENTINEL' } } },
        { anonymise: true },
      );
      expect(JSON.stringify(out)).toContain('SENTINEL');
    });
  });
});

// The structure the tree actually has. Both the raw UBJSON payload and
// `dumpNode`'s rendering interleave `children` / `values` between a node and its
// contents, so a rule written as `global/mixer_serial` describes a path that
// never literally occurs.
//
// This is a regression test for a real leak: the first dump taken from a live
// 16R wrote the serial, the registered owner and the device name into the file.
// Every rule was anchored on the logical path, every real path had `children` in
// the middle, nothing matched, and the redactor reported "redacted fields: 0" —
// a leak that looked exactly like success.
describe('the nesting a real dump has', () => {
  const realShape = () => ({
    internal: {
      children: {
        global: {
          children: {
            mixer_serial: 'RA1E24090034',
            registered_user: 'Jane Smith',
            devicename: 'Stage Rack',
            mixer_version: '3.4.0.111374',
          },
        },
        sdrecorder: {
          children: { session: { children: { artist: 'The Band', location: 'Village Hall' } } },
        },
        line: { children: { ch1: { children: { username: 'Vocal - Dana', color: 4278190335 } } } },
        permissions: { children: { access_code: 's3cret' } },
        networksetup: { children: { ipaddress: '192.168.1.50' } },
        users: { children: { user1: { children: { name: 'Jane' } } } },
      },
    },
    cache: { global: { mixer_serial: 'RA1E24090034' } },
  });

  describe('logicalPath', () => {
    it.each([
      ['internal/children/global/children/mixer_serial', 'internal/global/mixer_serial'],
      ['global/values/mixer_serial', 'global/mixer_serial'],
      ['line/children/ch1/values/username', 'line/ch1/username'],
      ['a/ranges/b/strings/c/states/d', 'a/b/c/d'],
    ])('reduces %s', (input, expected) => {
      expect(logicalPath(input)).toBe(expected);
    });

    it('leaves a path with no structural segments alone', () => {
      expect(logicalPath('global/mixer_serial')).toBe('global/mixer_serial');
    });
  });

  it.each([
    ['the serial', 'RA1E24090034'],
    ['the registered user', 'Jane Smith'],
    ['the device name', 'Stage Rack'],
    ['the access code', 's3cret'],
    ['the IP address', '192.168.1.50'],
    ['session metadata', 'Village Hall'],
  ])('redacts %s through the children nesting', (_label, secret) => {
    expect(JSON.stringify(redactStateDump(realShape()).dump)).not.toContain(secret);
  });

  it('reports what it redacted rather than claiming zero', () => {
    const { report } = redactStateDump(realShape());
    expect(report.redactedPaths.length).toBeGreaterThan(0);
    expect(report.removedRoots.length).toBeGreaterThan(0);
  });

  it('still keeps the diagnostically useful fields', () => {
    const { dump } = redactStateDump(realShape());
    const serialised = JSON.stringify(dump);
    expect(serialised).toContain('3.4.0.111374');
    expect(serialised).toContain('4278190335');
  });

  it('anonymises a channel label through the nesting', () => {
    const plain = JSON.stringify(redactStateDump(realShape()).dump);
    expect(plain).toContain('Vocal - Dana');
    const anon = JSON.stringify(redactStateDump(realShape(), { anonymise: true }).dump);
    expect(anon).not.toContain('Vocal - Dana');
  });
});

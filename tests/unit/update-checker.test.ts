import { compareVersions, pickLatestVersion } from '../../src/main/update-checker';

describe('compareVersions', () => {
  it('returns positive when v1 is newer (patch)', () => {
    expect(compareVersions('1.2.1', '1.2.0')).toBeGreaterThan(0);
  });

  it('returns negative when v1 is older (patch)', () => {
    expect(compareVersions('1.2.0', '1.2.1')).toBeLessThan(0);
  });

  it('returns 0 when versions are equal', () => {
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  });

  it('returns positive when v1 has higher major version', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('returns positive when v1 has higher minor version', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
  });

  it('handles missing patch part (treats as 0)', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('handles missing minor and patch parts', () => {
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0);
  });
});

describe('pickLatestVersion', () => {
  const REPO_BASE = 'https://github.com/sandinak/studiolive-midi-controller';

  it('uses tag when tag is newer than latest release', () => {
    const result = pickLatestVersion(
      { tag_name: 'v1.2.0', html_url: `${REPO_BASE}/releases/tag/v1.2.0`, body: 'Old notes' },
      [{ name: 'v1.2.1' }]
    );
    expect(result.latestVersion).toBe('1.2.1');
    expect(result.downloadUrl).toContain('v1.2.1');
    expect(result.releaseNotes).toBeNull(); // tags have no release notes
  });

  it('constructs correct tag URL when tag version is newer', () => {
    const result = pickLatestVersion(
      { tag_name: 'v1.1.0', html_url: `${REPO_BASE}/releases/tag/v1.1.0`, body: null },
      [{ name: 'v1.2.0' }]
    );
    expect(result.downloadUrl).toBe(`${REPO_BASE}/releases/tag/v1.2.0`);
  });

  it('uses release when release is newer than latest tag', () => {
    const result = pickLatestVersion(
      { tag_name: 'v1.2.1', html_url: `${REPO_BASE}/releases/tag/v1.2.1`, body: 'Release notes here' },
      [{ name: 'v1.2.0' }]
    );
    expect(result.latestVersion).toBe('1.2.1');
    expect(result.downloadUrl).toBe(`${REPO_BASE}/releases/tag/v1.2.1`);
    expect(result.releaseNotes).toBe('Release notes here');
  });

  it('uses release when versions are equal (prefer release notes)', () => {
    const result = pickLatestVersion(
      { tag_name: 'v1.2.0', html_url: `${REPO_BASE}/releases/tag/v1.2.0`, body: 'Notes' },
      [{ name: 'v1.2.0' }]
    );
    expect(result.latestVersion).toBe('1.2.0');
    expect(result.releaseNotes).toBe('Notes');
  });

  it('handles tag without "v" prefix', () => {
    const result = pickLatestVersion(
      { tag_name: 'v1.1.0', html_url: `${REPO_BASE}/releases/tag/v1.1.0`, body: null },
      [{ name: '1.2.0' }] // no 'v' prefix
    );
    expect(result.latestVersion).toBe('1.2.0');
    expect(result.downloadUrl).toBe(`${REPO_BASE}/releases/tag/v1.2.0`);
  });

  it('handles release tag_name with "v" prefix (strips it)', () => {
    const result = pickLatestVersion(
      { tag_name: 'v1.2.1', html_url: `${REPO_BASE}/releases/tag/v1.2.1`, body: null },
      [{ name: 'v1.2.0' }]
    );
    expect(result.latestVersion).toBe('1.2.1'); // stripped to '1.2.1' not 'v1.2.1'
  });

  it('returns 0.0.0 gracefully when both release and tags are null', () => {
    const result = pickLatestVersion(null, null);
    expect(result.latestVersion).toBe('0.0.0');
    expect(result.downloadUrl).toBeTruthy(); // fallback URL
    expect(result.releaseNotes).toBeNull();
  });

  it('uses tag URL when release is null but tag exists', () => {
    const result = pickLatestVersion(null, [{ name: 'v1.2.1' }]);
    expect(result.latestVersion).toBe('1.2.1');
    expect(result.downloadUrl).toContain('v1.2.1');
  });

  it('falls back to releases page URL when release data has no html_url', () => {
    const result = pickLatestVersion(
      { tag_name: 'v1.2.0' }, // no html_url
      [{ name: 'v1.1.0' }]
    );
    expect(result.downloadUrl).toContain('github.com');
  });
});

/**
 * Update checker utilities.
 * Pure functions with no I/O — easy to unit test.
 */

export interface ReleaseData {
  tag_name?: string;
  html_url?: string;
  body?: string;
}

export interface TagData {
  name?: string;
}

export interface UpdateInfo {
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string | null;
}

/**
 * Compare two semantic version strings.
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

/**
 * Given data from the GitHub releases/latest and tags APIs, pick the higher version.
 * Prefers the published release when versions are equal (for release notes).
 * Falls back to tag URL when the tag is newer than the latest release.
 */
export function pickLatestVersion(
  releaseData: ReleaseData | null,
  tagsData: TagData[] | null
): UpdateInfo {
  const releaseVersion = releaseData?.tag_name?.replace(/^v/, '') ?? '0.0.0';
  const tagVersion = tagsData?.[0]?.name?.replace(/^v/, '') ?? '0.0.0';

  if (compareVersions(tagVersion, releaseVersion) > 0) {
    // Latest tag is newer than latest published release
    const tagName = tagsData![0].name ?? `v${tagVersion}`;
    const tagNameWithV = tagName.startsWith('v') ? tagName : `v${tagName}`;
    return {
      latestVersion: tagVersion,
      downloadUrl: `https://github.com/sandinak/studiolive-midi-controller/releases/tag/${tagNameWithV}`,
      releaseNotes: null,
    };
  }

  // Latest published release is current or newer
  return {
    latestVersion: releaseVersion,
    downloadUrl: releaseData?.html_url ?? `https://github.com/sandinak/studiolive-midi-controller/releases`,
    releaseNotes: releaseData?.body ?? null,
  };
}

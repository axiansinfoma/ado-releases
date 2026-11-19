/** Parsed semantic version. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  raw: string;
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse a semantic version (without "v"). Returns undefined when it is not one. */
export function parseSemVer(version: string): SemVer | undefined {
  const m = SEMVER.exec(version);
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
    raw: version,
  };
}

/** Compare two versions by SemVer precedence. Invalid versions sort first. */
export function compareVersions(a: string, b: string): number {
  const x = parseSemVer(a);
  const y = parseSemVer(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (x[k] !== y[k]) return x[k] - y[k];
  }
  if (!x.prerelease.length || !y.prerelease.length) {
    return y.prerelease.length - x.prerelease.length;
  }
  const n = Math.max(x.prerelease.length, y.prerelease.length);
  for (let i = 0; i < n; i++) {
    const p = x.prerelease[i];
    const q = y.prerelease[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (Number(p) !== Number(q)) return Number(p) - Number(q);
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

export function isPrerelease(version: string): boolean {
  return (parseSemVer(version)?.prerelease.length ?? 0) > 0;
}

/**
 * Split a tag into package prefix and version.
 * "build-tools/cert-agent/v0.14.4" -> { prefix: "build-tools/cert-agent", version: "0.14.4" }
 * "v1.2.3" -> { prefix: "", version: "1.2.3" }
 */
export function parseTag(tag: string): { prefix: string; version: string } | undefined {
  const name = tag.replace(/^refs\/tags\//, '');
  const m = /^(?:(.*)\/)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?)$/.exec(name);
  if (!m || !parseSemVer(m[2]!)) return undefined;
  return { prefix: m[1] ?? '', version: m[2]! };
}

/** Build a tag name from prefix and version: ("a/b", "1.0.0") -> "a/b/v1.0.0", ("", "1.0.0") -> "v1.0.0". */
export function formatTag(prefix: string, version: string): string {
  return prefix ? `${prefix}/v${version}` : `v${version}`;
}

export type ChangeType = 'major' | 'minor' | 'patch';

/** Next version after `current` for a change type. Pre-release parts are dropped. */
export function bumpVersion(current: string | undefined, change: ChangeType): string {
  const v = current ? parseSemVer(current) : undefined;
  if (!v) return change === 'major' ? '1.0.0' : change === 'minor' ? '0.1.0' : '0.0.1';
  if (change === 'major') return `${v.major + 1}.0.0`;
  if (change === 'minor') return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

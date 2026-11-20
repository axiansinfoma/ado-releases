/** UI-independent logic of the hub (routing, grouping, defaults, error texts). */
import { AdoError, compareVersions, releaseDate, type PackageTag, type ReleaseRecord } from '@ado-releases/core';

export type Route =
  | { view: 'list'; package?: string }
  | { view: 'new'; package?: string; tag?: string }
  | { view: 'release'; package: string; version: string }
  | { view: 'edit'; package: string; version: string }
  | { view: 'settings' };

/** Route from the host page's query parameters (deep links). */
export function parseRoute(q: Record<string, string | undefined>): Route {
  // routeParams sets every key, so an empty value means "not set": after a reload, package=""
  // must not select the repository's own package (plain v-tags), whose name is the repository's
  const pkg = q.package || undefined;
  const tag = q.tag || undefined;
  switch (q.view) {
    case 'new':
      return { view: 'new', package: pkg, tag };
    case 'release':
    case 'edit':
      if (pkg !== undefined && q.version) return { view: q.view, package: pkg, version: q.version };
      return { view: 'list' };
    case 'settings':
      return { view: 'settings' };
    default:
      return pkg ? { view: 'list', package: pkg } : { view: 'list' };
  }
}

/** Query parameters for a route; every key is set so stale ones are cleared. */
export function routeParams(route: Route): Record<string, string> {
  const p: Record<string, string> = { view: route.view, package: '', version: '', tag: '' };
  if ('package' in route && route.package !== undefined) p.package = route.package;
  if ('version' in route) p.version = route.version;
  if (route.view === 'new' && route.tag) p.tag = route.tag;
  if (route.view === 'list') p.view = '';
  return p;
}

/** All releases of the given packages, newest first by date, then by version. */
export function mergeReleases(byPackage: Record<string, ReleaseRecord[]>, packageFilter?: string): ReleaseRecord[] {
  const all = Object.entries(byPackage)
    .filter(([pkg]) => !packageFilter || pkg === packageFilter)
    .flatMap(([, records]) => records);
  return all.sort((a, b) => releaseDate(b).localeCompare(releaseDate(a)) || compareVersions(b.version, a.version));
}

/** Tags of a package that have no release yet, newest first. */
export function tagsWithoutRelease(tags: PackageTag[], records: ReleaseRecord[]): PackageTag[] {
  const released = new Set(records.map((r) => r.version));
  return tags.filter((t) => !released.has(t.version)).sort((a, b) => compareVersions(b.version, a.version));
}

/** Package name of a tag prefix: the prefix, or the repository name for plain v<semver> tags. */
export function packageOf(prefix: string, repositoryName: string): string {
  return prefix || repositoryName;
}

/** Tag prefix of a package (inverse of packageOf). */
export function prefixOf(pkg: string, repositoryName: string): string {
  return pkg === repositoryName ? '' : pkg;
}

/** Path the notes of a monorepo package are limited to by default, if that folder exists. */
export function pathFilterCandidate(prefix: string): string | undefined {
  return prefix ? `/src/${prefix}` : undefined;
}

/** A tag prefix the user may type: path segments of letters, digits, ".", "_" and "-". */
export function isValidPrefix(prefix: string): boolean {
  return prefix === '' || /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(prefix);
}

/** Message for an error from the Azure DevOps API, with a hint where the cause is usually permissions. */
export function describeError(e: unknown): string {
  if (e instanceof AdoError) {
    if (e.status === 401 || e.status === 203) return `Not signed in or the token expired (${e.status}). Reload the page.`;
    if (e.status === 404 && /wiki/i.test(e.message)) {
      return `Wiki repository not found or not accessible: ${e.message}. Check the wiki in the settings.`;
    }
    if (e.status === 409 && /wiki/i.test(e.message)) {
      return `${e.message.replace(/: set the wiki repository$/, '')}: choose one in the settings.`;
    }
    if (e.status === 403 || /TF401027|permission/i.test(e.body)) {
      return `Permission denied: ${e.message}. Publishing needs "Contribute" on the wiki repository, and "Create tag" on this repository for new tags.`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

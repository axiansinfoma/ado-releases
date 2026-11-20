import { releaseDate, type ReleaseRecord } from './types.js';
import { compareVersions } from './version.js';

/** Links the renderers need. */
export interface RenderContext {
  /** Web URL of the source repository. */
  repositoryWebUrl: string;
  /** Web URL of a release page for a version. */
  releasePageUrl: (record: ReleaseRecord) => string;
  /** Web URL of a package overview page. */
  packagePageUrl: (repository: string, pkg: string) => string;
}

const META_START = '<!-- ado-releases:record ';
const META_END = ' -->';

/** Release records sorted newest first. */
export function sortNewestFirst(records: ReleaseRecord[]): ReleaseRecord[] {
  return [...records].sort((a, b) => compareVersions(b.version, a.version));
}

/** Latest stable release, or the newest pre-release when there is no stable one. */
export function latestRelease(records: ReleaseRecord[]): ReleaseRecord | undefined {
  const sorted = sortNewestFirst(records);
  return sorted.find((r) => !r.prerelease) ?? sorted[0];
}

function tagLink(ctx: RenderContext, tag: string): string {
  return `[${tag}](${ctx.repositoryWebUrl}?version=GT${encodeURIComponent(tag)})`;
}

function date(iso: string): string {
  return iso.slice(0, 10);
}

/** Markdown page of one release. Carries the record as hidden metadata so everything else can be rebuilt. */
export function renderReleasePage(record: ReleaseRecord, ctx: RenderContext, isLatest: boolean): string {
  const badges = [record.prerelease ? '`Pre-release`' : '', isLatest ? '`Latest`' : ''].filter(Boolean).join(' ');
  const header = [
    `**Tag:** ${tagLink(ctx, record.tag)}`,
    `**Released:** ${date(releaseDate(record))}`,
    date(record.publishedAt) !== date(releaseDate(record)) || record.publishedBy
      ? `**Published:** ${date(record.publishedAt)}${record.publishedBy ? ` by ${record.publishedBy}` : ''}`
      : '',
    record.previousTag ? `**Previous:** ${tagLink(ctx, record.previousTag)}` : '',
    `**Package:** [${record.package}](${ctx.packagePageUrl(record.repository, record.package)})`,
  ].filter(Boolean);
  const title = record.title && record.title !== record.version ? `# ${record.title}\n\n` : '';
  return (
    `${META_START}${JSON.stringify(record)}${META_END}\n` +
    title +
    (badges ? `${badges}\n\n` : '') +
    header.join(' · ') +
    '\n\n---\n\n' +
    record.notes.trim() +
    '\n'
  );
}

/** Read the record back from a release page. */
export function parseReleasePage(markdown: string): ReleaseRecord | undefined {
  const start = markdown.indexOf(META_START);
  if (start < 0) return undefined;
  const end = markdown.indexOf(META_END, start + META_START.length);
  if (end < 0) return undefined;
  try {
    const record = JSON.parse(markdown.slice(start + META_START.length, end)) as ReleaseRecord;
    return record.schema === 1 ? record : undefined;
  } catch {
    return undefined;
  }
}

/** Package overview: latest release with notes, then all releases. */
export function renderPackagePage(repository: string, pkg: string, records: ReleaseRecord[], ctx: RenderContext): string {
  const sorted = sortNewestFirst(records);
  const latest = latestRelease(records);
  const parts: string[] = [`Releases of **${pkg}** in [${repository}](${ctx.repositoryWebUrl}).`];
  if (latest) {
    parts.push(
      `## Latest: [${latest.version}](${ctx.releasePageUrl(latest)})${latest.prerelease ? ' `Pre-release`' : ''}\n\n` +
        `Released ${date(releaseDate(latest))} · ${tagLink(ctx, latest.tag)}\n\n` +
        latest.notes.trim().replace(/^(#{1,5}) /gm, '#$1 '),
    );
  }
  const rows = sorted.map(
    (r) =>
      `| [${r.version}](${ctx.releasePageUrl(r)}) | ${date(releaseDate(r))} | ${r.prerelease ? 'Pre-release' : 'Release'} | ${escapeCell(r.title)} |`,
  );
  parts.push(`## All releases\n\n| Version | Date | Type | Title |\n|---|---|---|---|\n${rows.join('\n')}`);
  return parts.join('\n\n') + '\n';
}

/** Summary of a package for the repository overview. */
export interface PackageSummary {
  package: string;
  latestVersion: string;
  publishedAt: string;
  /** Release date of the latest version; missing in summaries written before 0.2.5. */
  releasedAt?: string;
  prerelease: boolean;
}

/** Repository overview: one row per package with its latest release. */
export function renderRepositoryPage(repository: string, packages: PackageSummary[], ctx: RenderContext): string {
  const rows = [...packages]
    .sort((a, b) => a.package.localeCompare(b.package))
    .map(
      (p) =>
        `| [${p.package}](${ctx.packagePageUrl(repository, p.package)}) | ${p.latestVersion}${p.prerelease ? ' (pre-release)' : ''} | ${date(releaseDate(p))} |`,
    );
  return (
    `Releases of [${repository}](${ctx.repositoryWebUrl}).\n\n` +
    `| Package | Latest | Date |\n|---|---|---|\n${rows.join('\n')}\n`
  );
}

/** Page for folders without own content: lists its subpages. */
export function renderIndexPage(): string {
  return '[[_TOSP_]]\n';
}

/** Renovate custom datasource format, see https://docs.renovatebot.com/modules/datasource/custom/ */
export interface RenovateReleases {
  releases: Array<{
    version: string;
    releaseTimestamp: string;
    changelogContent: string;
    changelogUrl: string;
    isStable: boolean;
    sourceUrl: string;
  }>;
  sourceUrl: string;
  changelogUrl: string;
  homepage: string;
}

export function renderRenovateReleases(repository: string, pkg: string, records: ReleaseRecord[], ctx: RenderContext): RenovateReleases {
  const overview = ctx.packagePageUrl(repository, pkg);
  return {
    releases: [...records]
      .sort((a, b) => compareVersions(a.version, b.version))
      .map((r) => ({
        version: r.version,
        releaseTimestamp: releaseDate(r),
        changelogContent: r.notes.trim(),
        changelogUrl: ctx.releasePageUrl(r),
        isStable: !r.prerelease,
        sourceUrl: ctx.repositoryWebUrl,
      })),
    sourceUrl: ctx.repositoryWebUrl,
    changelogUrl: overview,
    homepage: overview,
  };
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

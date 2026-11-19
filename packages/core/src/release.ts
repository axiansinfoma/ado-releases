import type { AdoClient, GitRepository, GitTag, VersionRef } from './ado.js';
import { generateNotes, type GeneratedNotes } from './notes.js';
import type { WikiStore } from './store.js';
import type { FileChange, ReleaseRecord } from './types.js';
import { bumpVersion, compareVersions, formatTag, isPrerelease, parseTag, type ChangeType } from './version.js';

/**
 * Title of a release as "Generate release notes" fills it in: "<last package segment> v<version>"
 * for monorepo packages (e.g. "cert-agent v1.2.3"), "v<version>" for repository-level v-tags.
 */
export function releaseTitle(prefix: string, version: string): string {
  const name = prefix.split('/').filter(Boolean).pop();
  return name ? `${name} v${version}` : `v${version}`;
}

/**
 * Highest tag of the same package below `version`. For a stable version, pre-releases are skipped,
 * so the notes of 1.2.0 cover everything since 1.1.0 and not since 1.2.0-rc.1.
 */
export async function findPreviousTag(
  client: AdoClient,
  project: string,
  repository: GitRepository,
  prefix: string,
  version: string,
): Promise<string | undefined> {
  const tags = await client.listTags(project, repository.id, prefix ? `${prefix}/v` : 'v');
  const stable = !isPrerelease(version);
  let best: { tag: string; version: string } | undefined;
  for (const t of tags) {
    const parsed = parseTag(t.name);
    if (!parsed || parsed.prefix !== prefix) continue;
    if (compareVersions(parsed.version, version) >= 0) continue;
    if (stable && isPrerelease(parsed.version)) continue;
    if (!best || compareVersions(parsed.version, best.version) > 0) best = { tag: t.name, version: parsed.version };
  }
  return best?.tag;
}

/** A version tag of a package. */
export interface PackageTag {
  tag: string;
  version: string;
  commitId: string;
}

/** Version tags of one package (exact prefix), newest first. */
export async function listPackageTags(
  client: AdoClient,
  project: string,
  repository: GitRepository,
  prefix: string,
): Promise<PackageTag[]> {
  const tags = await client.listTags(project, repository.id, prefix ? `${prefix}/v` : 'v');
  const out: PackageTag[] = [];
  for (const t of tags) {
    const parsed = parseTag(t.name);
    if (parsed && parsed.prefix === prefix) out.push({ tag: t.name, version: parsed.version, commitId: t.commitId });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** Tag prefixes (packages) that have version tags in a repository; "" stands for plain v<semver> tags. */
export async function listTagPrefixes(client: AdoClient, project: string, repository: GitRepository): Promise<string[]> {
  const prefixes = new Set<string>();
  for (const t of await client.listTags(project, repository.id)) {
    const parsed = parseTag(t.name);
    if (parsed) prefixes.add(parsed.prefix);
  }
  return [...prefixes].sort();
}

/**
 * Next version for a package: the highest stable version bumped by the change type, or the
 * first version (0.1.0 / 0.0.1 / 1.0.0) when there is none.
 */
export function proposeVersion(versions: string[], change: ChangeType): string {
  const stable = versions.filter((v) => !isPrerelease(v)).sort(compareVersions);
  return bumpVersion(stable[stable.length - 1], change);
}

export interface PublishReleaseOptions {
  /** Project of the source repository. */
  project: string;
  /** Source repository name or id. */
  repository: string;
  /** Tag of the release, e.g. "build-tools/cert-agent/v0.14.4" or "v1.2.3". */
  tag: string;
  /** Previous tag; detected from the tags of the same package when omitted. */
  previousTag?: string;
  /** Package name; defaults to the tag prefix, or the repository name for "v1.2.3" tags. */
  package?: string;
  /** Limit notes to changes below this path. */
  pathFilter?: string;
  /** Mark as pre-release; defaults to whether the version has a pre-release part. */
  prerelease?: boolean;
  /** Default: releaseTitle(), e.g. "cert-agent v1.2.3" or "v1.2.3". */
  title?: string;
  /** Notes to use instead of generated ones. */
  notes?: string;
  /** Create the annotated tag on this commit when it does not exist yet. */
  createTagOnCommit?: string;
  /**
   * Kind of tag created with createTagOnCommit. Default "annotated" (message = release title).
   * "lightweight" needs only the scope vso.code_write; annotated tags need vso.code_manage, which
   * extension tokens usually don't have.
   */
  tagType?: 'annotated' | 'lightweight';
  publishedBy?: string;
  /** Publication timestamp (ISO). Default: now. Backfills pass the tagged commit's date. */
  publishedAt?: string;
  /** Release timestamp (ISO). Default: the tag's date, or the publish time for a tag created now. */
  releasedAt?: string;
  dryRun?: boolean;
  allowReplace?: boolean;
  /** Clock for tests. */
  now?: () => Date;
}

export interface PublishReleaseResult {
  record: ReleaseRecord;
  generated?: GeneratedNotes;
  files: FileChange[];
  wikiCommitId?: string;
  tagCreated: boolean;
}

/** Create the release record for a tag (generating notes if needed) and publish it to the wiki. */
export async function publishRelease(
  client: AdoClient,
  store: WikiStore,
  opts: PublishReleaseOptions,
): Promise<PublishReleaseResult> {
  const parsed = parseTag(opts.tag);
  if (!parsed) throw new Error(`tag ${opts.tag} is not "<prefix>/v<semver>" or "v<semver>"`);
  const repo = await client.getRepository(opts.project, opts.repository);
  const pkg = opts.package ?? (parsed.prefix || repo.name);
  if (formatTag(parsed.prefix, parsed.version) !== opts.tag.replace(/^refs\/tags\//, '')) {
    throw new Error(`tag ${opts.tag} must use the form ${formatTag(parsed.prefix, parsed.version)}`);
  }

  const existingTag = (await client.listTags(opts.project, repo.id, opts.tag)).find((t) => t.name === opts.tag);
  let commit = existingTag?.commitId;
  let tagCreated = false;
  if (!commit) {
    if (!opts.createTagOnCommit) throw new Error(`tag ${opts.tag} does not exist in ${repo.name}`);
    commit = opts.createTagOnCommit;
  }

  const previousTag =
    opts.previousTag ?? (await findPreviousTag(client, opts.project, repo, parsed.prefix, parsed.version));
  const to: VersionRef = existingTag ? { version: opts.tag, type: 'tag' } : { version: commit, type: 'commit' };
  const generated = opts.notes
    ? undefined
    : await generateNotes(client, {
        project: opts.project,
        repository: repo,
        to,
        previousTag,
        pathFilter: opts.pathFilter,
      });

  const publishedAt = opts.publishedAt ?? (opts.now?.() ?? new Date()).toISOString();
  const record: ReleaseRecord = {
    schema: 1,
    repository: repo.name,
    package: pkg,
    version: parsed.version,
    tag: opts.tag,
    previousTag,
    commit,
    title: opts.title ?? releaseTitle(parsed.prefix, parsed.version),
    notes: opts.notes ?? generated!.markdown,
    prerelease: opts.prerelease ?? isPrerelease(parsed.version),
    publishedAt,
    releasedAt: opts.releasedAt ?? (existingTag ? await tagDate(client, opts.project, repo.id, existingTag) : publishedAt),
    publishedBy: opts.publishedBy,
  };

  if (!existingTag && !opts.dryRun) {
    if (opts.tagType === 'lightweight') await client.createLightweightTag(opts.project, repo.id, opts.tag, commit);
    else await client.createAnnotatedTag(opts.project, repo.id, opts.tag, commit, record.title);
    tagCreated = true;
  }
  const { files, commitId } = await store.publish(record, repo.webUrl, {
    dryRun: opts.dryRun,
    allowReplace: opts.allowReplace,
  });
  return { record, generated, files, wikiCommitId: commitId, tagCreated };
}

/**
 * Date of an existing tag: the tagger date of an annotated tag, else (lightweight tag, or the tag
 * object can't be read) the committer date of the tagged commit. Undefined if neither is available.
 */
export async function tagDate(client: AdoClient, project: string, repositoryId: string, tag: GitTag): Promise<string | undefined> {
  if (tag.objectId !== tag.commitId) {
    const annotated = await client.getAnnotatedTag(project, repositoryId, tag.objectId).catch(() => undefined);
    if (annotated?.taggedBy?.date) return utc(annotated.taggedBy.date);
  }
  const commit = await client.getCommit(project, repositoryId, tag.commitId).catch(() => undefined);
  const d = commit?.committer?.date ?? commit?.author?.date;
  return d && utc(d);
}

/** Azure DevOps returns some dates without a zone (e.g. taggedBy.date "2026-11-12T09:17:36"); they are UTC. */
function utc(iso: string): string {
  return /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
}

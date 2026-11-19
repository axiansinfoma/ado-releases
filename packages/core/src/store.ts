import { isPushConflict, type AdoClient, type GitRepository, type PushChange } from './ado.js';
import {
  latestRelease,
  renderIndexPage,
  renderPackagePage,
  renderReleasePage,
  renderRenovateReleases,
  renderRepositoryPage,
  sortNewestFirst,
  type PackageSummary,
  type RenderContext,
} from './render.js';
import type { FileChange, ReleaseRecord, WikiLocation } from './types.js';
import { wikiPageUrl } from './urls.js';
import { encodePageName, pageFilePath, pageFolderPath, pagePath } from './wikiname.js';

/**
 * Layout in the wiki repository:
 *   /<root>.md                                     index of repositories
 *   /<root>/<repo>.md                              repository overview
 *   /<root>/<repo>/<pkg segments>.md               package overview (intermediate segments get index pages)
 *   /<root>/<repo>/<pkg segments>/<version>.md     one page per release
 *   /<root>/<repo>/<pkg segments>/.order           newest first
 *   /.<root lowercase>/<repo>/<pkg>/index.json     all records of the package (source for rebuilds)
 *   /.<root lowercase>/<repo>/<pkg>/releases.json  Renovate custom datasource
 *   /.<root lowercase>/<repo>/packages.json        package summaries for the repository overview
 * Page paths use wiki file name encoding; data paths use plain names so consumers can build URLs.
 */
export class WikiStore {
  readonly root: string;
  readonly dataRoot: string;
  private resolved?: { repo: GitRepository; branch: string; wikiName: string };

  constructor(
    private readonly client: AdoClient,
    private readonly location: WikiLocation,
  ) {
    this.root = (location.root ?? 'Releases').replace(/^\/+|\/+$/g, '');
    this.dataRoot = '.' + this.root.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  }

  private async resolve(): Promise<{ repo: GitRepository; branch: string; wikiName: string }> {
    if (!this.resolved) {
      const repo = this.location.repository
        ? await this.client.getRepository(this.location.project, this.location.repository)
        : await this.client.findProjectWikiRepository(this.location.project);
      const branch = (this.location.branch ?? repo.defaultBranch ?? 'wikiMaster').replace(/^refs\/heads\//, '');
      this.resolved = { repo, branch, wikiName: this.location.wikiName ?? repo.name };
    }
    return this.resolved;
  }

  /** Path of the data folder of a package, e.g. "/.releases/Container-Images/build-tools/cert-agent". */
  dataFolder(repository: string, pkg: string): string {
    return `/${this.dataRoot}/${repository}/${pkg}`.replace(/\/+/g, '/');
  }

  /** Path of the Renovate releases.json of a package. */
  releasesJsonPath(repository: string, pkg: string): string {
    return `${this.dataFolder(repository, pkg)}/releases.json`;
  }

  private packageSegments(repository: string, pkg: string): string[] {
    const segs = pkg === repository ? [] : pkg.split('/').filter(Boolean);
    return [this.root, repository, ...segs];
  }

  async renderContext(repositoryWebUrl: string): Promise<RenderContext> {
    const { wikiName } = await this.resolve();
    const url = (segments: string[]) =>
      wikiPageUrl(this.client.organizationUrl, this.location.project, wikiName, pagePath(segments));
    return {
      repositoryWebUrl,
      releasePageUrl: (r) => url([...this.packageSegments(r.repository, r.package), r.version]),
      packagePageUrl: (repository, pkg) => url(this.packageSegments(repository, pkg)),
    };
  }

  /** All records of a package, newest first. */
  async loadPackage(repository: string, pkg: string): Promise<ReleaseRecord[]> {
    const { repo, branch } = await this.resolve();
    const text = await this.client.getFileText(
      this.location.project,
      repo.id,
      `${this.dataFolder(repository, pkg)}/index.json`,
      branch,
    );
    if (!text) return [];
    const data = JSON.parse(text) as { schema: 1; records: ReleaseRecord[] };
    return sortNewestFirst(data.records);
  }

  /**
   * Files to write for publishing `record` on top of `existing` records.
   * `existingFiles` is the set of file paths present in the wiki repo below the page and data roots.
   */
  async planPublish(
    record: ReleaseRecord,
    existing: ReleaseRecord[],
    existingFiles: Set<string>,
    repositoryWebUrl: string,
    packages: PackageSummary[],
  ): Promise<FileChange[]> {
    const ctx = await this.renderContext(repositoryWebUrl);
    const records = sortNewestFirst([...existing.filter((r) => r.version !== record.version), record]);
    const latest = latestRelease(records);
    const segs = this.packageSegments(record.repository, record.package);
    const files: FileChange[] = [];

    // Release pages: the new one, plus the previous "Latest" one to move the badge.
    const previousLatest = latestRelease(existing);
    for (const r of records) {
      if (r === record || (previousLatest && r.version === previousLatest.version && previousLatest.version !== latest?.version)) {
        files.push({
          path: pageFilePath([...segs, r.version]),
          content: renderReleasePage(r, ctx, r.version === latest?.version),
        });
      }
    }
    files.push({
      path: pageFolderPath(segs) + '/.order',
      content: records.map((r) => encodePageName(r.version)).join('\n') + '\n',
    });
    files.push({ path: pageFilePath(segs), content: renderPackagePage(record.repository, record.package, records, ctx) });

    // Index pages for the root and intermediate package segments, only when missing.
    for (let i = 1; i < segs.length - 1; i++) {
      const p = pageFilePath(segs.slice(0, i + 1));
      if (i >= 2 && !existingFiles.has(p)) files.push({ path: p, content: renderIndexPage() });
    }
    const rootPage = pageFilePath([this.root]);
    if (!existingFiles.has(rootPage)) files.push({ path: rootPage, content: renderIndexPage() });

    // Repository overview (single-package repos: the package page is the repository page).
    const summaries = upsertSummary(packages, record.package, latest!);
    if (record.package !== record.repository) {
      files.push({
        path: pageFilePath([this.root, record.repository]),
        content: renderRepositoryPage(record.repository, summaries, ctx),
      });
    }

    const data = this.dataFolder(record.repository, record.package);
    files.push({ path: `${data}/index.json`, content: JSON.stringify({ schema: 1, records }, null, 2) + '\n' });
    files.push({
      path: `${data}/releases.json`,
      content: JSON.stringify(renderRenovateReleases(record.repository, record.package, records, ctx), null, 2) + '\n',
    });
    files.push({
      path: `/${this.dataRoot}/${record.repository}/packages.json`,
      content: JSON.stringify({ schema: 1, packages: summaries }, null, 2) + '\n',
    });
    return files;
  }

  /**
   * Publish (create or replace) a release. Retries when the wiki branch moved meanwhile.
   * With `dryRun`, returns the planned files without pushing.
   */
  async publish(
    record: ReleaseRecord,
    repositoryWebUrl: string,
    opts: { dryRun?: boolean; allowReplace?: boolean; retries?: number } = {},
  ): Promise<{ files: FileChange[]; commitId?: string }> {
    return this.mutate(record.repository, record.package, `Release ${record.package} ${record.version}`, opts, async (state) => {
      if (!opts.allowReplace && state.existing.some((r) => r.version === record.version)) {
        throw new Error(`release ${record.package} ${record.version} already exists`);
      }
      const files = await this.planPublish(record, state.existing, state.existingFiles, repositoryWebUrl, state.packages);
      return { files, deletes: [] };
    });
  }

  /**
   * Remove a release from the wiki: deletes its page and rewrites .order, the overviews, index.json,
   * releases.json and packages.json; moves the Latest badge. The git tag is not touched.
   * Removing the last release of a package removes the package's pages and data files.
   */
  async remove(
    repository: string,
    pkg: string,
    version: string,
    repositoryWebUrl: string,
    opts: { dryRun?: boolean; retries?: number } = {},
  ): Promise<{ files: FileChange[]; deletes: string[]; commitId?: string }> {
    return this.mutate(repository, pkg, `Remove release ${pkg} ${version}`, opts, async (state) => {
      const removed = state.existing.find((r) => r.version === version);
      if (!removed) throw new Error(`release ${pkg} ${version} does not exist`);
      return this.planRemove(removed, state.existing, state.existingFiles, repositoryWebUrl, state.packages);
    });
  }

  /** Files to write and delete for removing `removed` from `existing`. */
  async planRemove(
    removed: ReleaseRecord,
    existing: ReleaseRecord[],
    existingFiles: Set<string>,
    repositoryWebUrl: string,
    packages: PackageSummary[],
  ): Promise<{ files: FileChange[]; deletes: string[] }> {
    const ctx = await this.renderContext(repositoryWebUrl);
    const { repository, package: pkg } = removed;
    const records = sortNewestFirst(existing.filter((r) => r.version !== removed.version));
    const segs = this.packageSegments(repository, pkg);
    const data = this.dataFolder(repository, pkg);
    const files: FileChange[] = [];
    const deletes = [pageFilePath([...segs, removed.version])];
    let summaries: PackageSummary[];

    if (records.length) {
      const latest = latestRelease(records)!;
      if (latestRelease(existing)?.version !== latest.version) {
        files.push({ path: pageFilePath([...segs, latest.version]), content: renderReleasePage(latest, ctx, true) });
      }
      files.push({ path: pageFolderPath(segs) + '/.order', content: records.map((r) => encodePageName(r.version)).join('\n') + '\n' });
      files.push({ path: pageFilePath(segs), content: renderPackagePage(repository, pkg, records, ctx) });
      files.push({ path: `${data}/index.json`, content: JSON.stringify({ schema: 1, records }, null, 2) + '\n' });
      files.push({
        path: `${data}/releases.json`,
        content: JSON.stringify(renderRenovateReleases(repository, pkg, records, ctx), null, 2) + '\n',
      });
      summaries = upsertSummary(packages, pkg, latest);
    } else {
      for (const p of [pageFolderPath(segs) + '/.order', pageFilePath(segs), `${data}/index.json`, `${data}/releases.json`]) {
        if (existingFiles.has(p)) deletes.push(p);
      }
      summaries = packages.filter((p) => p.package !== pkg);
    }
    if (pkg !== repository) {
      files.push({ path: pageFilePath([this.root, repository]), content: renderRepositoryPage(repository, summaries, ctx) });
    }
    files.push({
      path: `/${this.dataRoot}/${repository}/packages.json`,
      content: JSON.stringify({ schema: 1, packages: summaries }, null, 2) + '\n',
    });
    return { files, deletes: deletes.filter((d) => existingFiles.has(d)) };
  }

  /** Read the current state, plan the change, push it as one commit; retry when the branch moved. */
  private async mutate(
    repository: string,
    pkg: string,
    message: string,
    opts: { dryRun?: boolean; retries?: number },
    plan: (state: {
      existing: ReleaseRecord[];
      existingFiles: Set<string>;
      packages: PackageSummary[];
    }) => Promise<{ files: FileChange[]; deletes: string[] }>,
  ): Promise<{ files: FileChange[]; deletes: string[]; commitId?: string }> {
    const { repo, branch } = await this.resolve();
    const retries = opts.retries ?? 5;
    for (let attempt = 0; ; attempt++) {
      const head = opts.dryRun ? '' : await this.client.getBranchHead(this.location.project, repo.id, branch);
      const existing = await this.loadPackage(repository, pkg);
      const existingFiles = new Set([
        ...(await this.client.listFiles(this.location.project, repo.id, pageFolderPath([this.root]), branch)),
        ...(await this.client.listFiles(this.location.project, repo.id, `/${this.dataRoot}`, branch)),
      ]);
      // The root page lives next to the root folder.
      const rootPage = pageFilePath([this.root]);
      if (await this.client.getFileText(this.location.project, repo.id, rootPage, branch)) existingFiles.add(rootPage);
      const packages = await this.listPackages(repository);
      const { files, deletes } = await plan({ existing, existingFiles, packages });
      if (opts.dryRun) return { files, deletes };

      const changes: PushChange[] = [
        ...files.map((f) => ({ ...f, changeType: existingFiles.has(f.path) ? ('edit' as const) : ('add' as const) })),
        ...deletes.map((path) => ({ path, content: '', changeType: 'delete' as const })),
      ];
      try {
        const commitId = await this.client.push(this.location.project, repo.id, branch, head, message, changes);
        return { files, deletes, commitId };
      } catch (e) {
        if (!isPushConflict(e) || attempt >= retries) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
      }
    }
  }

  /** Package summaries of a repository (latest version per package), from packages.json. */
  async listPackages(repository: string): Promise<PackageSummary[]> {
    const { repo, branch } = await this.resolve();
    const text = await this.client.getFileText(
      this.location.project,
      repo.id,
      `/${this.dataRoot}/${repository}/packages.json`,
      branch,
    );
    return text ? (JSON.parse(text) as { packages: PackageSummary[] }).packages : [];
  }

  /** Web URL of a release page. */
  async releasePageUrl(record: ReleaseRecord, repositoryWebUrl: string): Promise<string> {
    return (await this.renderContext(repositoryWebUrl)).releasePageUrl(record);
  }
}

function upsertSummary(packages: PackageSummary[], pkg: string, latest: ReleaseRecord): PackageSummary[] {
  const summary: PackageSummary = {
    package: pkg,
    latestVersion: latest.version,
    publishedAt: latest.publishedAt,
    prerelease: latest.prerelease,
  };
  return [...packages.filter((p) => p.package !== pkg), summary];
}

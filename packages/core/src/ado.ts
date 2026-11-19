/**
 * Minimal Azure DevOps REST client (Git only). Uses global fetch, so it runs in
 * Node >= 20, in pipeline tasks and in the browser (extension hub).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdoClientOptions {
  /** Organization URL, e.g. https://dev.azure.com/myorg */
  organizationUrl: string;
  /** Bearer token (Entra, System.AccessToken, extension access token) or a PAT with authScheme "pat". */
  token: string;
  authScheme?: 'bearer' | 'pat';
  fetch?: FetchLike;
  apiVersion?: string;
}

export class AdoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'AdoError';
  }
}

export interface GitRepository {
  id: string;
  name: string;
  defaultBranch?: string;
  webUrl: string;
  project: { id: string; name: string };
}

export interface GitTag {
  /** Name without refs/tags/. */
  name: string;
  /** Object id of the tag ref (annotated tag object or commit). */
  objectId: string;
  /** Commit the tag points to. */
  commitId: string;
}

export interface GitCommitRef {
  commitId: string;
  comment: string;
  author?: { name?: string; date?: string };
}

export interface PullRequestRef {
  pullRequestId: number;
  title: string;
  description?: string;
  status?: string;
  targetRefName?: string;
  closedDate?: string;
  createdBy?: { displayName?: string; uniqueName?: string };
}

/** A git version: tag, branch or commit id. */
export interface VersionRef {
  version: string;
  type: 'tag' | 'branch' | 'commit';
}

export interface PushChange {
  path: string;
  content: string;
  changeType: 'add' | 'edit' | 'delete';
}

export class AdoClient {
  private readonly base: string;
  private readonly authHeader: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiVersion: string;

  constructor(opts: AdoClientOptions) {
    this.base = opts.organizationUrl.replace(/\/+$/, '');
    this.authHeader =
      opts.authScheme === 'pat'
        ? `Basic ${btoa(`:${opts.token}`)}`
        : `Bearer ${opts.token}`;
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.apiVersion = opts.apiVersion ?? '7.1';
  }

  get organizationUrl(): string {
    return this.base;
  }

  private url(project: string, path: string, query: Record<string, string | number | undefined> = {}): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
    params.set('api-version', this.apiVersion);
    return `${this.base}/${encodeURIComponent(project)}/_apis/${path}?${params.toString()}`;
  }

  private async send(method: string, url: string, body?: unknown, accept = 'application/json'): Promise<Response> {
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: accept,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AdoError(`${method} ${url.split('?')[0]} failed: ${res.status} ${firstLine(text)}`, res.status, text);
    }
    return res;
  }

  private async json<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await this.send(method, url, body);
    const text = await res.text();
    // Azure DevOps answers unauthenticated requests with a 203 HTML sign-in page.
    if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
      throw new AdoError(`${method} ${url.split('?')[0]} returned no JSON (status ${res.status}); check the token`, res.status, text);
    }
    return JSON.parse(text) as T;
  }

  async getRepository(project: string, repository: string): Promise<GitRepository> {
    return this.json<GitRepository>('GET', this.url(project, `git/repositories/${encodeURIComponent(repository)}`));
  }

  /** Repositories of a project; with includeHidden also the hidden project wiki repository. */
  async listRepositories(project: string, includeHidden = false): Promise<GitRepository[]> {
    const data = await this.json<{ value: GitRepository[] }>(
      'GET',
      this.url(project, 'git/repositories', { includeHidden: includeHidden ? 'true' : undefined }),
    );
    return data.value;
  }

  /**
   * The project wiki's repository: "<project>.wiki" if it exists, otherwise the project's only hidden
   * "*.wiki" repository (a renamed project keeps its wiki repository name). Throws when there is none
   * or more than one candidate.
   */
  async findProjectWikiRepository(project: string): Promise<GitRepository> {
    try {
      return await this.getRepository(project, `${project}.wiki`);
    } catch (e) {
      if (!(e instanceof AdoError) || e.status !== 404) throw e;
    }
    const visible = new Set((await this.listRepositories(project)).map((r) => r.id));
    const candidates = (await this.listRepositories(project, true)).filter(
      (r) => !visible.has(r.id) && r.name.toLowerCase().endsWith('.wiki'),
    );
    if (candidates.length === 1) return candidates[0]!;
    if (!candidates.length) {
      throw new AdoError(`no project wiki found in ${project}: create the project wiki or set the wiki repository`, 404, '');
    }
    throw new AdoError(
      `several wiki repositories in ${project} (${candidates.map((r) => r.name).join(', ')}): set the wiki repository`,
      409,
      '',
    );
  }

  /** Tags whose name starts with `prefix` (without refs/tags/), with the commit they point to. */
  async listTags(project: string, repositoryId: string, prefix = ''): Promise<GitTag[]> {
    const out: GitTag[] = [];
    let continuationToken: string | undefined;
    do {
      const url = this.url(project, `git/repositories/${repositoryId}/refs`, {
        filter: `tags/${prefix}`,
        peelTags: 'true',
        $top: 1000,
        continuationToken,
      });
      const res = await this.send('GET', url);
      const data = (await res.json()) as { value: Array<{ name: string; objectId: string; peeledObjectId?: string }> };
      for (const r of data.value) {
        out.push({
          name: r.name.replace(/^refs\/tags\//, ''),
          objectId: r.objectId,
          commitId: r.peeledObjectId ?? r.objectId,
        });
      }
      continuationToken = res.headers.get('x-ms-continuationtoken') ?? undefined;
    } while (continuationToken);
    return out;
  }

  /**
   * Create a lightweight tag (a ref pointing at the commit) through the Refs API. Unlike annotated
   * tags (scope vso.code_manage), this needs only vso.code_write, the scope extensions usually get.
   */
  async createLightweightTag(project: string, repositoryId: string, name: string, commitId: string): Promise<GitTag> {
    const res = await this.json<{ value: Array<{ success: boolean; updateStatus: string; customMessage?: string }> }>(
      'POST',
      this.url(project, `git/repositories/${repositoryId}/refs`),
      [{ name: `refs/tags/${name}`, oldObjectId: '0'.repeat(40), newObjectId: commitId }],
    );
    const r = res.value[0];
    if (!r?.success) {
      throw new AdoError(`creating tag ${name} failed: ${r?.customMessage ?? r?.updateStatus ?? 'no result'}`, 409, JSON.stringify(res));
    }
    return { name, objectId: commitId, commitId };
  }

  async createAnnotatedTag(
    project: string,
    repositoryId: string,
    name: string,
    commitId: string,
    message: string,
  ): Promise<GitTag> {
    const res = await this.json<{ name: string; objectId: string; taggedObject: { objectId: string } }>(
      'POST',
      this.url(project, `git/repositories/${repositoryId}/annotatedtags`),
      { name, message, taggedObject: { objectId: commitId } },
    );
    return { name: res.name, objectId: res.objectId, commitId: res.taggedObject.objectId };
  }

  /**
   * Commits reachable from `to` but not from `from`, newest first.
   * Without `from`, all commits up to `to` (bounded by `top`).
   * `itemPath` limits to commits touching that path.
   */
  async getCommitRange(
    project: string,
    repositoryId: string,
    to: VersionRef,
    from?: VersionRef,
    itemPath?: string,
    top = 500,
  ): Promise<GitCommitRef[]> {
    const out: GitCommitRef[] = [];
    const pageSize = Math.min(top, 100);
    for (let skip = 0; skip < top; skip += pageSize) {
      // Azure DevOps semantics: itemVersion is the base (old), compareVersion the target (new).
      const query: Record<string, string | number | undefined> = from
        ? {
            'searchCriteria.itemVersion.version': from.version,
            'searchCriteria.itemVersion.versionType': from.type,
            'searchCriteria.compareVersion.version': to.version,
            'searchCriteria.compareVersion.versionType': to.type,
          }
        : {
            'searchCriteria.itemVersion.version': to.version,
            'searchCriteria.itemVersion.versionType': to.type,
          };
      query['searchCriteria.itemPath'] = itemPath;
      query['searchCriteria.$top'] = pageSize;
      query['searchCriteria.$skip'] = skip;
      const data = await this.json<{ value: GitCommitRef[] }>(
        'GET',
        this.url(project, `git/repositories/${repositoryId}/commits`, query),
      );
      out.push(...data.value);
      if (data.value.length < pageSize) break;
    }
    return out;
  }

  async getCommit(project: string, repositoryId: string, commitId: string): Promise<GitCommitRef & { committer?: { date?: string } }> {
    return this.json('GET', this.url(project, `git/repositories/${repositoryId}/commits/${commitId}`));
  }

  /**
   * Pull requests for commits: first as the PR's merge commit (squash / rebase merges),
   * then as a commit contained in the PR. Returns commitId -> PR.
   */
  async findPullRequestsForCommits(
    project: string,
    repositoryId: string,
    commitIds: string[],
  ): Promise<Map<string, PullRequestRef>> {
    const found = new Map<string, PullRequestRef>();
    for (let i = 0; i < commitIds.length; i += 100) {
      const chunk = commitIds.slice(i, i + 100);
      const data = await this.json<{ results: Array<Record<string, PullRequestRef[]>> }>(
        'POST',
        this.url(project, `git/repositories/${repositoryId}/pullrequestquery`),
        {
          queries: [
            { type: 'lastMergeCommit', items: chunk },
            { type: 'commit', items: chunk },
          ],
        },
      );
      for (const result of data.results) {
        for (const [commitId, prs] of Object.entries(result)) {
          const pr = prs.find((p) => p.status === 'completed') ?? prs[0];
          if (pr && !found.has(commitId)) found.set(commitId, pr);
        }
      }
    }
    return found;
  }

  async getPullRequest(project: string, repositoryId: string, id: number): Promise<PullRequestRef> {
    return this.json<PullRequestRef>('GET', this.url(project, `git/repositories/${repositoryId}/pullrequests/${id}`));
  }

  /** Text of a file, or undefined when it does not exist. */
  async getFileText(project: string, repositoryId: string, path: string, branch: string): Promise<string | undefined> {
    try {
      const res = await this.send(
        'GET',
        this.url(project, `git/repositories/${repositoryId}/items`, {
          path,
          'versionDescriptor.version': branch,
          'versionDescriptor.versionType': 'branch',
          $format: 'octetStream',
        }),
        undefined,
        'application/octet-stream',
      );
      return await res.text();
    } catch (e) {
      if (e instanceof AdoError && e.status === 404) return undefined;
      throw e;
    }
  }

  /** File paths below a folder (recursive). Empty when the folder does not exist. */
  async listFiles(project: string, repositoryId: string, scopePath: string, branch: string): Promise<string[]> {
    try {
      const data = await this.json<{ value: Array<{ path: string; gitObjectType: string }> }>(
        'GET',
        this.url(project, `git/repositories/${repositoryId}/items`, {
          scopePath,
          recursionLevel: 'Full',
          'versionDescriptor.version': branch,
          'versionDescriptor.versionType': 'branch',
        }),
      );
      return data.value.filter((i) => i.gitObjectType === 'blob').map((i) => i.path);
    } catch (e) {
      if (e instanceof AdoError && e.status === 404) return [];
      throw e;
    }
  }

  async getBranchHead(project: string, repositoryId: string, branch: string): Promise<string> {
    const name = branch.replace(/^refs\/heads\//, '');
    const data = await this.json<{ value: Array<{ name: string; objectId: string }> }>(
      'GET',
      this.url(project, `git/repositories/${repositoryId}/refs`, { filter: `heads/${name}` }),
    );
    const ref = data.value.find((r) => r.name === `refs/heads/${name}`);
    if (!ref) throw new AdoError(`branch ${name} not found`, 404, '');
    return ref.objectId;
  }

  /** Branch names (without refs/heads/) with their head commits. */
  async listBranches(project: string, repositoryId: string): Promise<Array<{ name: string; objectId: string }>> {
    const data = await this.json<{ value: Array<{ name: string; objectId: string }> }>(
      'GET',
      this.url(project, `git/repositories/${repositoryId}/refs`, { filter: 'heads/', $top: 1000 }),
    );
    return data.value.map((r) => ({ name: r.name.replace(/^refs\/heads\//, ''), objectId: r.objectId }));
  }

  /** Whether a file or folder exists at `path` on `branch`. */
  async pathExists(project: string, repositoryId: string, path: string, branch: string): Promise<boolean> {
    try {
      await this.json('GET', this.url(project, `git/repositories/${repositoryId}/items`, {
        scopePath: path,
        recursionLevel: 'None',
        'versionDescriptor.version': branch,
        'versionDescriptor.versionType': 'branch',
      }));
      return true;
    } catch (e) {
      if (e instanceof AdoError && e.status === 404) return false;
      throw e;
    }
  }

  /** Push one commit. Fails with AdoError (status 409 or TF401028 in body) when the branch moved. */
  async push(
    project: string,
    repositoryId: string,
    branch: string,
    oldObjectId: string,
    comment: string,
    changes: PushChange[],
  ): Promise<string> {
    const name = branch.replace(/^refs\/heads\//, '');
    const data = await this.json<{ commits: Array<{ commitId: string }> }>(
      'POST',
      this.url(project, `git/repositories/${repositoryId}/pushes`),
      {
        refUpdates: [{ name: `refs/heads/${name}`, oldObjectId }],
        commits: [
          {
            comment,
            changes: changes.map((c) =>
              c.changeType === 'delete'
                ? { changeType: 'delete', item: { path: c.path } }
                : {
                    changeType: c.changeType,
                    item: { path: c.path },
                    newContent: { content: c.content, contentType: 'rawtext' },
                  },
            ),
          },
        ],
      },
    );
    return data.commits[0]?.commitId ?? '';
  }
}

/** Whether an error means the branch moved since it was read (optimistic concurrency). */
export function isPushConflict(e: unknown): boolean {
  return e instanceof AdoError && (e.status === 409 || /TF401028|TF401027|GitReferenceStaleException/.test(e.body));
}

function firstLine(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    // not JSON
  }
  return text.split('\n')[0]!.slice(0, 200);
}

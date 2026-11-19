/**
 * In-memory fake of the Azure DevOps Git REST endpoints the core uses.
 * Routes by URL path; records pushes; can simulate a concurrent push.
 */
export interface FakeRepo {
  id: string;
  name: string;
  defaultBranch: string;
  tags: Record<string, string>; // tag -> commit
  /** Commits newest first with the paths they touch. */
  commits: Array<{ commitId: string; comment: string; paths: string[] }>;
  prs: Array<{ pullRequestId: number; title: string; description: string; lastMergeCommit: string; commits: string[] }>;
  files: Map<string, string>;
  head: string;
}

export class FakeAdo {
  readonly repos = new Map<string, FakeRepo>();
  readonly pushes: Array<{ repo: string; comment: string; changes: Array<{ changeType: string; path: string; content?: string }> }> = [];
  readonly createdTags: Array<{ name: string; commit: string }> = [];
  /** Number of pushes that should fail with a stale-ref conflict before succeeding. */
  conflicts = 0;

  constructor(readonly org = 'https://dev.azure.com/org', readonly project = 'Proj') {}

  add(repo: Partial<FakeRepo> & { name: string }): FakeRepo {
    const r: FakeRepo = {
      id: `${repo.name}-id`,
      defaultBranch: 'refs/heads/main',
      tags: {},
      commits: [],
      prs: [],
      files: new Map(),
      head: 'head0',
      ...repo,
    };
    this.repos.set(r.name, r);
    this.repos.set(r.id, r);
    return r;
  }

  private repo(idOrName: string): FakeRepo {
    const r = this.repos.get(decodeURIComponent(idOrName));
    if (!r) throw new Error(`no repo ${idOrName}`);
    return r;
  }

  private range(r: FakeRepo, version: string, type: string): Set<string> {
    const commit = type === 'tag' ? r.tags[version] : version;
    const idx = r.commits.findIndex((c) => c.commitId === commit);
    return new Set(idx < 0 ? [] : r.commits.slice(idx).map((c) => c.commitId));
  }

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const q = url.searchParams;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const m = /\/_apis\/git\/repositories\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!m) return json(404, { message: 'not found' });
    const r = this.repo(m[1]!);
    const sub = m[2] ?? '';
    const webUrl = `${this.org}/${this.project}/_git/${r.name}`;

    if (sub === '') {
      return json(200, { id: r.id, name: r.name, defaultBranch: r.defaultBranch, webUrl, project: { id: 'p', name: this.project } });
    }
    if (sub === 'refs') {
      const filter = q.get('filter') ?? '';
      if (filter.startsWith('heads/')) {
        return json(200, { value: [{ name: `refs/${filter}`, objectId: r.head }] });
      }
      const prefix = filter.replace(/^tags\//, '');
      const value = Object.entries(r.tags)
        .filter(([t]) => t.startsWith(prefix))
        .map(([t, c]) => ({ name: `refs/tags/${t}`, objectId: `tagobj-${t}`, peeledObjectId: c }));
      return json(200, { value });
    }
    if (sub === 'annotatedtags' && method === 'POST') {
      r.tags[body.name] = body.taggedObject.objectId;
      this.createdTags.push({ name: body.name, commit: body.taggedObject.objectId });
      return json(200, { name: body.name, objectId: 'newtag', taggedObject: { objectId: body.taggedObject.objectId } });
    }
    if (sub === 'commits') {
      const toV = q.get('searchCriteria.compareVersion.version');
      const fromV = q.get('searchCriteria.itemVersion.version')!;
      const itemPath = q.get('searchCriteria.itemPath');
      let ids: Set<string>;
      if (toV) {
        const to = this.range(r, toV, q.get('searchCriteria.compareVersion.versionType')!);
        const from = this.range(r, fromV, q.get('searchCriteria.itemVersion.versionType')!);
        ids = new Set([...to].filter((c) => !from.has(c)));
      } else {
        ids = this.range(r, fromV, q.get('searchCriteria.itemVersion.versionType')!);
      }
      const skip = Number(q.get('searchCriteria.$skip') ?? 0);
      const top = Number(q.get('searchCriteria.$top') ?? 100);
      const value = r.commits
        .filter((c) => ids.has(c.commitId))
        .filter((c) => !itemPath || c.paths.some((p) => p.startsWith(itemPath)))
        .slice(skip, skip + top)
        .map((c) => ({ commitId: c.commitId, comment: c.comment }));
      return json(200, { count: value.length, value });
    }
    if (sub === 'pullrequestquery') {
      const results = body.queries.map((query: { type: string; items: string[] }) => {
        const out: Record<string, unknown[]> = {};
        for (const id of query.items) {
          const prs = r.prs.filter((p) => (query.type === 'lastMergeCommit' ? p.lastMergeCommit === id : p.commits.includes(id)));
          if (prs.length) out[id] = prs.map((p) => ({ ...p, status: 'completed' }));
        }
        return out;
      });
      return json(200, { results });
    }
    const pr = /^pullrequests\/(\d+)$/.exec(sub);
    if (pr) {
      const p = r.prs.find((x) => x.pullRequestId === Number(pr[1]));
      return p ? json(200, p) : json(404, { message: 'no pr' });
    }
    if (sub === 'items') {
      if (q.get('path')) {
        const content = r.files.get(q.get('path')!);
        return content === undefined ? json(404, { message: 'TF401174: not found' }) : new Response(content, { status: 200 });
      }
      const scope = q.get('scopePath')!;
      const value = [...r.files.keys()]
        .filter((p) => p.startsWith(scope + '/'))
        .map((path) => ({ path, gitObjectType: 'blob' }));
      return value.length ? json(200, { value }) : json(404, { message: 'TF401174' });
    }
    if (sub === 'pushes' && method === 'POST') {
      if (body.refUpdates[0].oldObjectId !== r.head) return json(409, { message: 'TF401028: The reference has already been updated' });
      if (this.conflicts > 0) {
        this.conflicts--;
        r.head = `${r.head}x`; // someone else pushed
        return json(409, { message: 'TF401028: The reference has already been updated' });
      }
      const changes = body.commits[0].changes.map((c: { changeType: string; item: { path: string }; newContent?: { content: string } }) => ({
        changeType: c.changeType,
        path: c.item.path,
        content: c.newContent?.content,
      }));
      for (const c of changes) {
        if (c.changeType === 'add' && r.files.has(c.path)) return json(400, { message: `add of existing ${c.path}` });
        if (c.changeType === 'edit' && !r.files.has(c.path)) return json(400, { message: `edit of missing ${c.path}` });
      }
      for (const c of changes) r.files.set(c.path, c.content);
      this.pushes.push({ repo: r.name, comment: body.commits[0].comment, changes });
      r.head = `push${this.pushes.length}`;
      return json(201, { commits: [{ commitId: r.head }] });
    }
    return json(404, { message: `unhandled ${method} ${sub}` });
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Core functions the Releases hub needs: remove, package listing, tag helpers, branches, paths. */
import { beforeEach, describe, expect, it } from 'vitest';
import { AdoClient } from '../src/ado.js';
import { listPackageTags, listTagPrefixes, proposeVersion, publishRelease } from '../src/release.js';
import { WikiStore } from '../src/store.js';
import { FakeAdo } from './fake-ado.js';

let ado: FakeAdo;
let client: AdoClient;
let store: WikiStore;
const now = () => new Date('2026-11-19T12:00:00Z');
const web = 'https://dev.azure.com/org/Proj/_git/Mono-Repo';
const pkgPage = '/Releases/Mono%2DRepo/tools/cert%2Dagent.md';
const page = (v: string) => `/Releases/Mono%2DRepo/tools/cert%2Dagent/${v}.md`;
const data = '/.releases/Mono-Repo/tools/cert-agent';

beforeEach(() => {
  ado = new FakeAdo();
  ado.add({
    name: 'Mono-Repo',
    tags: {
      'tools/cert-agent/v1.0.0': 'c1',
      'tools/cert-agent/v1.1.0': 'c2',
      'tools/cert-agent/v1.2.0-rc.1': 'c3',
      'tools/other/v0.3.0': 'c2',
      'v2.0.0': 'c3',
      'not-a-version': 'c1',
    },
    commits: [
      { commitId: 'c3', comment: 'feat: three', paths: ['/src/tools/cert-agent/x'] },
      { commitId: 'c2', comment: 'fix: two', paths: ['/src/tools/cert-agent/x'] },
      { commitId: 'c1', comment: 'init', paths: ['/src/tools/cert-agent/x'] },
    ],
    files: new Map([['/src/tools/cert-agent/Dockerfile', 'FROM scratch']]),
    branches: { main: 'c3', 'feature/x': 'c2' },
  });
  ado.add({ name: 'Proj.wiki', defaultBranch: 'refs/heads/wikiMaster' });
  client = new AdoClient({ organizationUrl: ado.org, token: 't', fetch: ado.fetch });
  store = new WikiStore(client, { project: 'Proj', repository: 'Proj.wiki' });
});

const publish = (tag: string) => publishRelease(client, store, { project: 'Proj', repository: 'Mono-Repo', tag, now });

describe('WikiStore.remove', () => {
  it('removes the latest release, moves the badge and rewrites all derived files', async () => {
    await publish('tools/cert-agent/v1.0.0');
    await publish('tools/cert-agent/v1.1.0');
    await publish('tools/other/v0.3.0');

    const res = await store.remove('Mono-Repo', 'tools/cert-agent', '1.1.0', web);
    expect(res.deletes).toEqual([page('1.1.0')]);
    const files = ado.repos.get('Proj.wiki')!.files;
    expect(files.has(page('1.1.0'))).toBe(false);
    expect(files.get(page('1.0.0'))).toContain('`Latest`');
    expect(files.get('/Releases/Mono%2DRepo/tools/cert%2Dagent/.order')).toBe('1.0.0\n');
    expect(files.get(pkgPage)).toContain('## Latest: [1.0.0]');
    expect(JSON.parse(files.get(`${data}/releases.json`)!).releases.map((r: { version: string }) => r.version)).toEqual(['1.0.0']);
    const packages = await store.listPackages('Mono-Repo');
    expect(packages.find((p) => p.package === 'tools/cert-agent')?.latestVersion).toBe('1.0.0');
    expect(packages.find((p) => p.package === 'tools/other')?.latestVersion).toBe('0.3.0');
    expect(files.get('/Releases/Mono%2DRepo.md')).toContain('| 1.0.0 |');
    expect(ado.pushes.at(-1)!.comment).toBe('Remove release tools/cert-agent 1.1.0');
  });

  it('removing an older release keeps the Latest page untouched', async () => {
    await publish('tools/cert-agent/v1.0.0');
    await publish('tools/cert-agent/v1.1.0');
    const res = await store.remove('Mono-Repo', 'tools/cert-agent', '1.0.0', web);
    expect(res.files.map((f) => f.path)).not.toContain(page('1.1.0'));
  });

  it('removing the last release removes the package pages and data, and the package from the overview', async () => {
    await publish('tools/cert-agent/v1.0.0');
    await publish('tools/other/v0.3.0');
    await store.remove('Mono-Repo', 'tools/cert-agent', '1.0.0', web);
    const files = ado.repos.get('Proj.wiki')!.files;
    for (const p of [page('1.0.0'), pkgPage, '/Releases/Mono%2DRepo/tools/cert%2Dagent/.order', `${data}/index.json`, `${data}/releases.json`]) {
      expect(files.has(p), p).toBe(false);
    }
    expect((await store.listPackages('Mono-Repo')).map((p) => p.package)).toEqual(['tools/other']);
    expect(files.get('/Releases/Mono%2DRepo.md')).not.toContain('cert-agent');
    expect(await store.loadPackage('Mono-Repo', 'tools/cert-agent')).toEqual([]);
  });

  it('fails for an unknown version and supports dry runs', async () => {
    await publish('tools/cert-agent/v1.0.0');
    await expect(store.remove('Mono-Repo', 'tools/cert-agent', '9.9.9', web)).rejects.toThrow(/does not exist/);
    const pushes = ado.pushes.length;
    const dry = await store.remove('Mono-Repo', 'tools/cert-agent', '1.0.0', web, { dryRun: true });
    expect(dry.deletes).toContain(page('1.0.0'));
    expect(ado.pushes).toHaveLength(pushes);
  });
});

describe('tag helpers', () => {
  it('lists the tags of one package newest first and the prefixes of a repository', async () => {
    const repo = await client.getRepository('Proj', 'Mono-Repo');
    expect((await listPackageTags(client, 'Proj', repo, 'tools/cert-agent')).map((t) => t.version)).toEqual([
      '1.2.0-rc.1',
      '1.1.0',
      '1.0.0',
    ]);
    expect((await listPackageTags(client, 'Proj', repo, '')).map((t) => t.tag)).toEqual(['v2.0.0']);
    expect(await listTagPrefixes(client, 'Proj', repo)).toEqual(['', 'tools/cert-agent', 'tools/other']);
  });

  it('proposes the next version from the highest stable version', () => {
    expect(proposeVersion(['1.0.0', '1.2.0-rc.1', '1.1.0'], 'patch')).toBe('1.1.1');
    expect(proposeVersion(['1.0.9', '1.0.10'], 'minor')).toBe('1.1.0');
    expect(proposeVersion([], 'minor')).toBe('0.1.0');
  });
});

describe('client helpers', () => {
  it('lists branches and checks paths', async () => {
    const repo = await client.getRepository('Proj', 'Mono-Repo');
    expect(await client.listBranches('Proj', repo.id)).toEqual([
      { name: 'main', objectId: 'c3' },
      { name: 'feature/x', objectId: 'c2' },
    ]);
    expect(await client.pathExists('Proj', repo.id, '/src/tools/cert-agent', 'main')).toBe(true);
    expect(await client.pathExists('Proj', repo.id, '/src/tools/missing', 'main')).toBe(false);
  });
});

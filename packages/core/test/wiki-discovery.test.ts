/**
 * Without a configured wiki repository the store finds the project wiki: "<project>.wiki", or,
 * after a project rename (the wiki repository keeps its old name), the only hidden "*.wiki" repo.
 */
import { describe, expect, it } from 'vitest';
import { AdoClient, AdoError } from '../src/ado.js';
import { publishRelease } from '../src/release.js';
import { WikiStore } from '../src/store.js';
import { FakeAdo } from './fake-ado.js';

function setup(wikis: Array<{ name: string; hidden: boolean }>) {
  const ado = new FakeAdo();
  ado.add({
    name: 'Repo',
    tags: { 'v1.0.0': 'a1', 'v1.1.0': 'a2' },
    commits: [
      { commitId: 'a2', comment: 'feat: new', paths: ['/x'] },
      { commitId: 'a1', comment: 'init', paths: ['/x'] },
    ],
  });
  for (const w of wikis) ado.add({ name: w.name, hidden: w.hidden, defaultBranch: 'refs/heads/wikiMaster' });
  const client = new AdoClient({ organizationUrl: ado.org, token: 't', fetch: ado.fetch });
  return { ado, client };
}

describe('project wiki discovery', () => {
  it('uses <project>.wiki when it exists', async () => {
    const { client } = setup([{ name: 'Proj.wiki', hidden: true }]);
    expect((await client.findProjectWikiRepository('Proj')).name).toBe('Proj.wiki');
  });

  it('finds the hidden wiki repository of a renamed project and publishes there', async () => {
    const { ado, client } = setup([{ name: 'OldName.wiki', hidden: true }]);
    expect((await client.findProjectWikiRepository('Proj')).name).toBe('OldName.wiki');

    const store = new WikiStore(client, { project: 'Proj' });
    const res = await publishRelease(client, store, { project: 'Proj', repository: 'Repo', tag: 'v1.1.0' });
    expect(ado.pushes[0]!.repo).toBe('OldName.wiki');
    const ctx = await store.renderContext('https://example');
    expect(ctx.releasePageUrl(res.record)).toContain('/_wiki/wikis/OldName.wiki?');
  });

  it('ignores visible repositories that merely end in .wiki', async () => {
    const { client } = setup([
      { name: 'docs.wiki', hidden: false },
      { name: 'OldName.wiki', hidden: true },
    ]);
    expect((await client.findProjectWikiRepository('Proj')).name).toBe('OldName.wiki');
  });

  it('explains when there is no project wiki or several candidates', async () => {
    const none = setup([]);
    await expect(none.client.findProjectWikiRepository('Proj')).rejects.toThrow(/no project wiki found in Proj/);

    const two = setup([
      { name: 'A.wiki', hidden: true },
      { name: 'B.wiki', hidden: true },
    ]);
    const err = await two.client.findProjectWikiRepository('Proj').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdoError);
    expect((err as AdoError).message).toMatch(/several wiki repositories in Proj \(A\.wiki, B\.wiki\)/);
  });

  it('still uses an explicitly configured repository', async () => {
    const { ado, client } = setup([
      { name: 'Proj.wiki', hidden: true },
      { name: 'Other.wiki', hidden: false },
    ]);
    const store = new WikiStore(client, { project: 'Proj', repository: 'Other.wiki' });
    await publishRelease(client, store, { project: 'Proj', repository: 'Repo', tag: 'v1.1.0' });
    expect(ado.pushes[0]!.repo).toBe('Other.wiki');
  });
});

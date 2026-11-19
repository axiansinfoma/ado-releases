/**
 * The release date (releasedAt, Renovate's releaseTimestamp) comes from the tag, not from the time
 * the release was published: publishing an old tag later must not make it look new.
 */
import { describe, expect, it } from 'vitest';
import { AdoClient } from '../src/ado.js';
import { publishRelease } from '../src/release.js';
import { renderRenovateReleases } from '../src/render.js';
import { WikiStore } from '../src/store.js';
import { releaseDate, type ReleaseRecord } from '../src/types.js';
import { FakeAdo } from './fake-ado.js';

const NOW = '2026-11-19T12:00:00.000Z';
const now = () => new Date(NOW);

function setup() {
  const ado = new FakeAdo();
  ado.add({
    name: 'Repo',
    tags: { 'v1.0.0': 'a1', 'v1.1.0': 'a2' },
    tagDates: { 'v1.1.0': '2026-10-02T08:00:00' }, // v1.1.0 annotated (no zone, as Azure DevOps returns it), v1.0.0 lightweight
    commits: [
      { commitId: 'a3', comment: 'fix: later', paths: ['/x'], date: '2026-11-01T09:00:00Z' },
      { commitId: 'a2', comment: 'feat: new', paths: ['/x'], date: '2026-10-01T10:00:00Z' },
      { commitId: 'a1', comment: 'init', paths: ['/x'], date: '2026-09-01T10:00:00Z' },
    ],
  });
  ado.add({ name: 'Proj.wiki', hidden: true, defaultBranch: 'refs/heads/wikiMaster' });
  const client = new AdoClient({ organizationUrl: ado.org, token: 't', fetch: ado.fetch });
  return { client, store: new WikiStore(client, { project: 'Proj' }) };
}

describe('release date', () => {
  it('uses the tagger date of an annotated tag, as UTC', async () => {
    const { client, store } = setup();
    const res = await publishRelease(client, store, { project: 'Proj', repository: 'Repo', tag: 'v1.1.0', now });
    expect(res.record.publishedAt).toBe(NOW);
    expect(res.record.releasedAt).toBe('2026-10-02T08:00:00Z');
  });

  it('uses the commit date of a lightweight tag', async () => {
    const { client, store } = setup();
    const res = await publishRelease(client, store, { project: 'Proj', repository: 'Repo', tag: 'v1.0.0', now });
    expect(res.record.releasedAt).toBe('2026-09-01T10:00:00Z');
  });

  it('uses the publish time for a tag created by the publish', async () => {
    const { client, store } = setup();
    const res = await publishRelease(client, store, {
      project: 'Proj',
      repository: 'Repo',
      tag: 'v1.1.1',
      createTagOnCommit: 'a3',
      tagType: 'lightweight',
      now,
    });
    expect(res.record.releasedAt).toBe(NOW);
  });

  it('feeds Renovate the release date and falls back to publishedAt for old records', () => {
    const base = { schema: 1, repository: 'Repo', package: 'Repo', commit: 'c', title: '', notes: 'n', prerelease: false } as const;
    const records: ReleaseRecord[] = [
      { ...base, version: '1.0.0', tag: 'v1.0.0', publishedAt: NOW, releasedAt: '2026-09-01T10:00:00Z' },
      { ...base, version: '1.1.0', tag: 'v1.1.0', publishedAt: '2026-10-05T00:00:00Z' },
    ];
    const ctx = { repositoryWebUrl: 'https://x/_git/Repo', releasePageUrl: () => 'u', packagePageUrl: () => 'p' } as never;
    const out = renderRenovateReleases('Repo', 'Repo', records, ctx);
    expect(out.releases.map((r) => r.releaseTimestamp)).toEqual(['2026-09-01T10:00:00Z', '2026-10-05T00:00:00Z']);
    expect(releaseDate(records[1]!)).toBe('2026-10-05T00:00:00Z');
  });
});

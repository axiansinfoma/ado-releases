import { beforeEach, describe, expect, it } from 'vitest';
import { AdoClient } from '../src/ado.js';
import { parseReleasePage } from '../src/render.js';
import { publishRelease } from '../src/release.js';
import { WikiStore } from '../src/store.js';
import { FakeAdo } from './fake-ado.js';

let ado: FakeAdo;
let client: AdoClient;
let store: WikiStore;
const now = () => new Date('2026-11-19T12:00:00Z');

beforeEach(() => {
  ado = new FakeAdo();
  ado.add({
    name: 'Container-Images',
    tags: { 'build-tools/cert-agent/v0.14.3': 'c1', 'build-tools/cert-agent/v0.14.4': 'c4', 'build-tools/other/v1.0.0': 'c3' },
    commits: [
      { commitId: 'c5', comment: 'feat: unreleased', paths: ['/src/build-tools/cert-agent/x'] },
      { commitId: 'c4', comment: 'fix(go-tools): clear the backlog #1234', paths: ['/src/build-tools/cert-agent/main.go'] },
      { commitId: 'c3', comment: 'feat: other image', paths: ['/src/build-tools/other/x'] },
      { commitId: 'c2', comment: 'ci: lint', paths: ['/src/build-tools/cert-agent/.golangci.yml'] },
      { commitId: 'c1', comment: 'old', paths: ['/src/build-tools/cert-agent/x'] },
    ],
    prs: [
      {
        pullRequestId: 101,
        title: 'fix(go-tools): clear the golangci-lint backlog',
        description: 'x\n\n## Release notes\n\nNo behaviour change.',
        lastMergeCommit: 'c4',
        commits: ['c4'],
        createdBy: { displayName: 'Jane Doe' },
      },
      { pullRequestId: 100, title: 'ci: golangci-lint for Go images', description: '', lastMergeCommit: 'm9', commits: ['c2'] },
    ],
  });
  ado.add({ name: 'Proj.wiki', defaultBranch: 'refs/heads/wikiMaster' });
  client = new AdoClient({ organizationUrl: ado.org, token: 't', fetch: ado.fetch });
  store = new WikiStore(client, { project: 'Proj', repository: 'Proj.wiki' });
});

describe('publishRelease', () => {
  it('generates notes from PRs between tags and writes pages, order, index and releases.json', async () => {
    const res = await publishRelease(client, store, {
      project: 'Proj',
      repository: 'Container-Images',
      tag: 'build-tools/cert-agent/v0.14.4',
      pathFilter: '/src/build-tools/cert-agent',
      now,
    });

    expect(res.record.previousTag).toBe('build-tools/cert-agent/v0.14.3');
    expect(res.record.package).toBe('build-tools/cert-agent');
    expect(res.generated?.changeType).toBe('patch');
    expect(res.record.notes).toContain('**go-tools:** clear the golangci-lint backlog by Jane Doe in [!101]');
    expect(res.record.title).toBe('cert-agent v0.14.4');
    expect(res.record.notes).toContain('No behaviour change.');
    expect(res.record.notes).toContain('ci: golangci-lint for Go images'.replace('ci: ', ''));
    expect(res.record.notes).not.toContain('other image');
    expect(res.record.notes).not.toContain('unreleased');
    expect(res.tagCreated).toBe(false);

    const files = ado.repos.get('Proj.wiki')!.files;
    expect([...files.keys()].sort()).toEqual([
      '/.releases/Container-Images/build-tools/cert-agent/index.json',
      '/.releases/Container-Images/build-tools/cert-agent/releases.json',
      '/.releases/Container-Images/packages.json',
      '/Releases.md',
      '/Releases/Container%2DImages.md',
      '/Releases/Container%2DImages/build%2Dtools.md',
      '/Releases/Container%2DImages/build%2Dtools/cert%2Dagent.md',
      '/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/.order',
      '/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/0.14.4.md',
    ]);
    const renovate = JSON.parse(files.get('/.releases/Container-Images/build-tools/cert-agent/releases.json')!);
    expect(renovate.releases).toHaveLength(1);
    expect(renovate.releases[0]).toMatchObject({ version: '0.14.4', isStable: true, releaseTimestamp: '2026-11-19T12:00:00.000Z' });
    expect(renovate.releases[0].changelogUrl).toBe(
      'https://dev.azure.com/org/Proj/_wiki/wikis/Proj.wiki?pagePath=%2FReleases%2FContainer-Images%2Fbuild-tools%2Fcert-agent%2F0.14.4',
    );
    expect(parseReleasePage(files.get('/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/0.14.4.md')!)).toEqual(res.record);
  });

  it('adds a second release with edit changes, moves the Latest badge and keeps order newest first', async () => {
    await publishRelease(client, store, { project: 'Proj', repository: 'Container-Images', tag: 'build-tools/cert-agent/v0.14.3', now });
    await publishRelease(client, store, { project: 'Proj', repository: 'Container-Images', tag: 'build-tools/cert-agent/v0.14.4', now });

    const second = ado.pushes[1]!;
    const byPath = new Map(second.changes.map((c) => [c.path, c.changeType]));
    expect(byPath.get('/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/0.14.4.md')).toBe('add');
    expect(byPath.get('/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/0.14.3.md')).toBe('edit');
    expect(byPath.has('/Releases.md')).toBe(false);

    const files = ado.repos.get('Proj.wiki')!.files;
    expect(files.get('/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/.order')).toBe('0.14.4\n0.14.3\n');
    expect(files.get('/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/0.14.3.md')).not.toContain('`Latest`');
    expect(files.get('/Releases/Container%2DImages/build%2Dtools/cert%2Dagent/0.14.4.md')).toContain('`Latest`');
  });

  it('refuses to publish the same version twice unless replacing', async () => {
    const opts = { project: 'Proj', repository: 'Container-Images', tag: 'build-tools/cert-agent/v0.14.4', now };
    await publishRelease(client, store, opts);
    await expect(publishRelease(client, store, opts)).rejects.toThrow(/already exists/);
    await publishRelease(client, store, { ...opts, allowReplace: true, notes: 'manual' });
    expect(ado.repos.get('Proj.wiki')!.files.get('/.releases/Container-Images/build-tools/cert-agent/releases.json')).toContain('"changelogContent": "manual"');
  });

  it('retries when the wiki branch moved', async () => {
    ado.conflicts = 2;
    const res = await publishRelease(client, store, { project: 'Proj', repository: 'Container-Images', tag: 'build-tools/cert-agent/v0.14.4', now });
    expect(res.wikiCommitId).toBe('push1');
  });

  it('creates the tag on a commit when it does not exist, and dry-run writes nothing', async () => {
    const dry = await publishRelease(client, store, {
      project: 'Proj',
      repository: 'Container-Images',
      tag: 'build-tools/cert-agent/v0.15.0',
      createTagOnCommit: 'c5',
      pathFilter: '/src/build-tools/cert-agent',
      dryRun: true,
      now,
    });
    expect(dry.files.length).toBeGreaterThan(0);
    expect(dry.generated?.changeType).toBe('minor');
    expect(ado.pushes).toHaveLength(0);
    expect(ado.createdTags).toHaveLength(0);

    const res = await publishRelease(client, store, {
      project: 'Proj',
      repository: 'Container-Images',
      tag: 'build-tools/cert-agent/v0.15.0',
      createTagOnCommit: 'c5',
      pathFilter: '/src/build-tools/cert-agent',
      now,
    });
    expect(res.tagCreated).toBe(true);
    expect(ado.createdTags).toEqual([{ name: 'build-tools/cert-agent/v0.15.0', commit: 'c5' }]);
    expect(res.record.previousTag).toBe('build-tools/cert-agent/v0.14.4');
    expect(res.record.notes).toContain('unreleased');
  });

  it('uses the repository name as package for v-tags and skips pre-release tags as previous', async () => {
    ado.add({
      name: 'Orders-API',
      tags: { 'v1.8.0': 'b1', 'v1.9.0-rc.1': 'b2', 'v1.9.0': 'b4' },
      commits: [
        { commitId: 'b4', comment: 'chore: bump version to 1.9.1 [skip ci]', paths: ['/main.go'] },
        { commitId: 'b3', comment: 'feat: releases api', paths: ['/x'] },
        { commitId: 'b2', comment: 'fix: rc fix', paths: ['/x'] },
        { commitId: 'b1', comment: 'old', paths: ['/x'] },
      ],
    });
    const res = await publishRelease(client, store, { project: 'Proj', repository: 'Orders-API', tag: 'v1.9.0', now });
    expect(res.record.package).toBe('Orders-API');
    expect(res.record.title).toBe('v1.9.0');
    expect(res.record.previousTag).toBe('v1.8.0');
    expect(res.record.notes).toContain('rc fix');
    expect(res.record.notes).not.toContain('bump version');
    const files = ado.repos.get('Proj.wiki')!.files;
    expect(files.has('/Releases/Orders%2DAPI/1.9.0.md')).toBe(true);
    expect(files.has('/.releases/Orders-API/Orders-API/releases.json')).toBe(true);
  });
});

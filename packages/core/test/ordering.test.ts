/**
 * Double-digit version parts (1.0.9 -> 1.0.10) must order numerically everywhere:
 * previous-tag detection, .order, Latest badge, overview table, releases.json.
 * Azure DevOps returns refs sorted as strings ("v1.0.10" before "v1.0.9").
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AdoClient } from '../src/ado.js';
import { findPreviousTag, publishRelease } from '../src/release.js';
import { WikiStore } from '../src/store.js';
import { compareVersions } from '../src/version.js';
import { FakeAdo } from './fake-ado.js';

let ado: FakeAdo;
let client: AdoClient;
let store: WikiStore;
const now = () => new Date('2026-11-19T12:00:00Z');
const page = (v: string) => `/Releases/Repo/${v}.md`;

beforeEach(() => {
  ado = new FakeAdo();
  // Insertion order mimics the string order Azure DevOps returns refs in.
  ado.add({
    name: 'Repo',
    tags: { 'v1.0.10': 'k10', 'v1.0.11-rc.1': 'k11rc', 'v1.0.2': 'k2', 'v1.0.9': 'k9' },
    commits: [
      { commitId: 'k12', comment: 'fix: twelve', paths: ['/x'] },
      { commitId: 'k11rc', comment: 'fix: eleven rc', paths: ['/x'] },
      { commitId: 'k10', comment: 'fix: ten', paths: ['/x'] },
      { commitId: 'k9', comment: 'fix: nine', paths: ['/x'] },
      { commitId: 'k3', comment: 'fix: three to nine', paths: ['/x'] },
      { commitId: 'k2', comment: 'fix: two', paths: ['/x'] },
    ],
  });
  ado.add({ name: 'Proj.wiki', defaultBranch: 'refs/heads/wikiMaster' });
  client = new AdoClient({ organizationUrl: ado.org, token: 't', fetch: ado.fetch });
  store = new WikiStore(client, { project: 'Proj', repository: 'Proj.wiki' });
});

const publish = (tag: string) => publishRelease(client, store, { project: 'Proj', repository: 'Repo', tag, now });

describe('double-digit versions', () => {
  it('compares numerically, including numeric pre-release identifiers', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.99')).toBeGreaterThan(0);
    expect(compareVersions('10.0.0', '9.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-preview.26569.10', '1.0.0-preview.26569.9')).toBeGreaterThan(0);
  });

  it('detects the previous tag numerically', async () => {
    const repo = await client.getRepository('Proj', 'Repo');
    expect(await findPreviousTag(client, 'Proj', repo, '', '1.0.10')).toBe('v1.0.9');
    expect(await findPreviousTag(client, 'Proj', repo, '', '1.0.9')).toBe('v1.0.2');
    // Stable 1.0.11 skips 1.0.11-rc.1 and goes back to 1.0.10.
    expect(await findPreviousTag(client, 'Proj', repo, '', '1.0.11')).toBe('v1.0.10');
    // A pre-release looks back to the previous pre-release or release.
    expect(await findPreviousTag(client, 'Proj', repo, '', '1.0.11-rc.2')).toBe('v1.0.11-rc.1');
  });

  it('notes of 1.0.10 cover only 1.0.9..1.0.10', async () => {
    const res = await publish('v1.0.10');
    expect(res.record.previousTag).toBe('v1.0.9');
    expect(res.record.notes).toContain('ten');
    expect(res.record.notes).not.toContain('nine');
  });

  it('keeps .order, Latest badge, overview and releases.json in numeric order, also when backfilling older versions afterwards', async () => {
    await publish('v1.0.10');
    await publish('v1.0.9'); // backfill after the newer release
    await publish('v1.0.2');
    await publish('v1.0.11-rc.1');

    const files = ado.repos.get('Proj.wiki')!.files;
    expect(files.get('/Releases/Repo/.order')).toBe('1.0.11%2Drc.1\n1.0.10\n1.0.9\n1.0.2\n');

    // Latest = newest stable; the pre-release does not take it, older backfills do not take it.
    expect(files.get(page('1.0.10'))).toContain('`Latest`');
    for (const v of ['1.0.9', '1.0.2']) expect(files.get(page(v))).not.toContain('`Latest`');
    expect(files.get(page('1.0.11%2Drc.1'))).toContain('`Pre-release`');
    expect(files.get(page('1.0.11%2Drc.1'))).not.toContain('`Latest`');

    const overview = files.get('/Releases/Repo.md')!;
    expect(overview).toContain('## Latest: [1.0.10]');
    const rows = overview.split('\n').filter((l) => l.startsWith('| ['));
    expect(rows.map((l) => /\[(.*?)\]/.exec(l)![1])).toEqual(['1.0.11-rc.1', '1.0.10', '1.0.9', '1.0.2']);

    const renovate = JSON.parse(files.get('/.releases/Repo/Repo/releases.json')!);
    expect(renovate.releases.map((r: { version: string }) => r.version)).toEqual(['1.0.2', '1.0.9', '1.0.10', '1.0.11-rc.1']);

    const index = JSON.parse(files.get('/.releases/Repo/Repo/index.json')!);
    expect(index.records.map((r: { version: string }) => r.version)).toEqual(['1.0.11-rc.1', '1.0.10', '1.0.9', '1.0.2']);
  });

  it('moves the Latest badge from 1.0.9 to 1.0.10', async () => {
    await publish('v1.0.9');
    await publish('v1.0.10');
    const files = ado.repos.get('Proj.wiki')!.files;
    expect(files.get(page('1.0.9'))).not.toContain('`Latest`');
    expect(files.get(page('1.0.10'))).toContain('`Latest`');
  });
});

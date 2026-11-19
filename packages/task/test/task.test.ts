import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdo } from '../../core/test/fake-ado.js';
import { accessToken, choice, input, run } from '../src/index.js';

let ado: FakeAdo;
let out: string[];

function env(inputs: Record<string, string>): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    SYSTEM_COLLECTIONURI: `${ado.org}/`,
    SYSTEM_TEAMPROJECT: 'Proj',
    BUILD_REPOSITORY_NAME: 'Repo',
    BUILD_REQUESTEDFOR: 'Pipeline User',
    ENDPOINT_AUTH_SYSTEMVSSCONNECTION: JSON.stringify({ parameters: { AccessToken: 'job-token' }, scheme: 'OAuth' }),
  };
  for (const [k, v] of Object.entries(inputs)) e[`INPUT_${k.toUpperCase()}`] = v;
  return e;
}

beforeEach(() => {
  ado = new FakeAdo();
  ado.add({
    name: 'Repo',
    tags: { 'v1.0.0': 'a1', 'v1.1.0': 'a2' },
    commits: [
      { commitId: 'a2', comment: 'feat: new thing', paths: ['/x'] },
      { commitId: 'a1', comment: 'init', paths: ['/x'] },
    ],
  });
  ado.add({ name: 'Proj.wiki', defaultBranch: 'refs/heads/wikiMaster' });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer job-token');
    return ado.fetch(url, init);
  });
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
    out.push(String(s));
    return true;
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('task', () => {
  it('reads inputs and the job token like the agent passes them', () => {
    const e = env({ tag: ' v1.1.0 ', previoustag: '' });
    expect(input('tag', e)).toBe('v1.1.0');
    expect(input('previousTag', e)).toBeUndefined();
    expect(accessToken(e)).toBe('job-token');
    expect(() => accessToken({})).toThrow(/access token/);
  });

  it('publishes and sets output variables', async () => {
    await run(env({ tag: 'v1.1.0', repository: 'Repo', project: 'Proj', ifexists: 'skip', prerelease: 'auto' }));
    expect(ado.pushes).toHaveLength(1);
    expect(ado.pushes[0]!.changes.map((c) => c.path)).toContain('/.releases/Repo/Repo/releases.json');
    const page = ado.repos.get('Proj.wiki')!.files.get('/Releases/Repo/1.1.0.md')!;
    expect(page).toContain('by Pipeline User');
    expect(page).toContain('new thing');
    expect(out).toContain('##vso[task.setvariable variable=releaseVersion;isOutput=true]1.1.0\n');
    expect(out.some((l) => l.startsWith('##vso[task.setvariable variable=releaseUrl;isOutput=true]https://dev.azure.com/org/Proj/_wiki/'))).toBe(true);
  });

  it('skips an existing release on re-runs and fails when asked to', async () => {
    await run(env({ tag: 'v1.1.0' }));
    await run(env({ tag: 'v1.1.0', ifexists: 'skip' }));
    expect(ado.pushes).toHaveLength(1);
    await expect(run(env({ tag: 'v1.1.0', ifexists: 'fail' }))).rejects.toThrow(/already exists/);
  });

  it('rejects a tag that is not a version tag', async () => {
    await expect(run(env({ tag: 'latest' }))).rejects.toThrow(/not/);
  });
});

describe('boolean and pickList inputs', () => {
  it('accepts template booleans "True"/"False" and mixed-case choices', () => {
    expect(choice('dryRun', ['true', 'false'], 'false', env({ dryrun: 'True' }))).toBe('true');
    expect(choice('dryRun', ['true', 'false'], 'false', env({ dryrun: 'False' }))).toBe('false');
    expect(choice('prerelease', ['auto', 'true', 'false'], 'auto', env({ prerelease: 'TRUE' }))).toBe('true');
    expect(choice('ifExists', ['skip', 'fail', 'replace'], 'skip', env({}))).toBe('skip');
    expect(() => choice('ifExists', ['skip', 'fail', 'replace'], 'skip', env({ ifexists: 'maybe' }))).toThrow(/one of/);
  });

  it('honours dryRun "True" from a template: nothing is pushed', async () => {
    await run(env({ tag: 'v1.1.0', dryrun: 'True', ifexists: 'Skip', prerelease: 'False' }));
    expect(ado.pushes).toHaveLength(0);
    expect(out.some((l) => l.startsWith('##vso[task.setvariable variable=releaseVersion;isOutput=true]1.1.0'))).toBe(true);
  });
});

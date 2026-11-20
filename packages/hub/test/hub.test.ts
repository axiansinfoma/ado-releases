import { AdoError, type GitRepository, type ReleaseRecord } from '@ado-releases/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';
import {
  describeError,
  isValidPrefix,
  mergeReleases,
  packageOf,
  parseRoute,
  pathFilterCandidate,
  prefixOf,
  routeParams,
  tagsWithoutRelease,
  type Route,
} from '../src/model.js';
import { resolveWikiLocation, saveSettings, settingsKey } from '../src/settings.js';
import { ReleaseCard } from '../src/views/ReleaseCard.js';

const rec = (pkg: string, version: string, publishedAt: string, extra: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
  schema: 1,
  repository: 'Mono-Repo',
  package: pkg,
  version,
  tag: `${pkg}/v${version}`,
  commit: '0123456789abcdef',
  title: version,
  notes: `- change in ${version}`,
  prerelease: version.includes('-'),
  publishedAt,
  ...extra,
});

describe('routes', () => {
  it('round-trips every route through query parameters', () => {
    const routes: Route[] = [
      { view: 'list' },
      { view: 'list', package: 'tools/a' },
      { view: 'new', package: 'tools/a', tag: 'tools/a/v1.0.0' },
      { view: 'new' },
      { view: 'new', package: 'tools/a' },
      { view: 'release', package: 'tools/a', version: '1.0.10' },
      { view: 'edit', package: 'Mono-Repo', version: '2.0.0' },
      { view: 'settings' },
    ];
    for (const r of routes) {
      // the host returns every parameter routeParams set, empty ones included (e.g. after a reload)
      expect(parseRoute(routeParams(r))).toEqual(r);
    }
  });

  it('falls back to the list for incomplete deep links and clears stale parameters', () => {
    expect(parseRoute({ view: 'release', package: 'x' })).toEqual({ view: 'list' });
    expect(parseRoute({ view: 'nonsense' })).toEqual({ view: 'list' });
    expect(routeParams({ view: 'settings' })).toEqual({ view: 'settings', package: '', version: '', tag: '' });
  });
});

describe('model', () => {
  it('merges releases of all packages newest first and filters by package', () => {
    const byPackage = {
      'tools/a': [rec('tools/a', '1.0.9', '2026-01-01T00:00:00Z'), rec('tools/a', '1.0.10', '2026-01-01T00:00:00Z')],
      'tools/b': [rec('tools/b', '0.1.0', '2026-02-01T00:00:00Z')],
    };
    expect(mergeReleases(byPackage).map((r) => `${r.package}@${r.version}`)).toEqual([
      'tools/b@0.1.0',
      'tools/a@1.0.10',
      'tools/a@1.0.9',
    ]);
    expect(mergeReleases(byPackage, 'tools/a').map((r) => r.version)).toEqual(['1.0.10', '1.0.9']);
  });

  it('finds tags without release, newest first', () => {
    const tags = ['1.0.9', '1.0.10', '1.1.0'].map((v) => ({ tag: `p/v${v}`, version: v, commitId: 'c' }));
    expect(tagsWithoutRelease(tags, [rec('p', '1.0.10', 'x')]).map((t) => t.version)).toEqual(['1.1.0', '1.0.9']);
  });

  it('maps packages and prefixes, validates prefixes and proposes the path filter', () => {
    expect(packageOf('', 'Repo')).toBe('Repo');
    expect(packageOf('tools/a', 'Repo')).toBe('tools/a');
    expect(prefixOf('Repo', 'Repo')).toBe('');
    expect(isValidPrefix('tools/my-tool')).toBe(true);
    expect(isValidPrefix('')).toBe(true);
    expect(isValidPrefix('a//b')).toBe(false);
    expect(isValidPrefix('a b')).toBe(false);
    expect(pathFilterCandidate('tools/a')).toBe('/src/tools/a');
    expect(pathFilterCandidate('')).toBeUndefined();
  });

  it('explains permission and auth errors', () => {
    expect(describeError(new AdoError('POST pushes failed: 403', 403, ''))).toMatch(/Permission denied.*Contribute/);
    expect(describeError(new AdoError('x', 401, ''))).toMatch(/token expired/);
    // the screenshot case: wiki repository named after the old project name -> not found, not "permission denied"
    const tf401019 = 'TF401019: The Git repository with name or identifier Proj.wiki does not exist or you do not have permissions';
    expect(describeError(new AdoError('GET .../git/repositories/Proj.wiki failed: 404 ' + tf401019, 404, tf401019))).toMatch(
      /^Wiki repository not found or not accessible.*settings/,
    );
    expect(describeError(new AdoError('several wiki repositories in Proj (A.wiki, B.wiki): set the wiki repository', 409, ''))).toBe(
      'several wiki repositories in Proj (A.wiki, B.wiki): choose one in the settings.',
    );
    expect(describeError(new Error('plain'))).toBe('plain');
  });
});

describe('settings', () => {
  it('defaults to the project wiki and the Releases root', () => {
    expect(resolveWikiLocation('Proj', {})).toEqual({ project: 'Proj', repository: undefined, branch: undefined, root: 'Releases' });
    expect(resolveWikiLocation('Proj', { wikiProject: 'Docs', root: ' Rel ' })).toEqual({
      project: 'Docs',
      repository: undefined, // found in Docs at runtime
      branch: undefined,
      root: 'Rel',
    });
  });

  it('stores only non-empty, trimmed values per project', async () => {
    const stored: Record<string, unknown> = {};
    const dm = {
      getValue: async <T>(k: string) => stored[k] as T,
      setValue: async <T>(k: string, v: T) => ((stored[k] = v), v),
    };
    await saveSettings(dm, 'p1', { wiki: ' Other.wiki ', root: '', branch: undefined });
    expect(stored[settingsKey('p1')]).toEqual({ wiki: 'Other.wiki' });
  });
});

describe('markdown', () => {
  it('renders GFM, strips scripts and opens links in a new tab', () => {
    const html = renderMarkdown('## Fixes\n\n- a [PR](https://example.org/pr/1)\n\n<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).toContain('<h2>Fixes</h2>');
    expect(html).toContain('href="https://example.org/pr/1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });
});

describe('ReleaseCard', () => {
  it('renders badges, links and notes like a GitHub release', () => {
    const repo = { id: 'r', name: 'Mono-Repo', webUrl: 'https://dev.azure.com/org/Proj/_git/Mono-Repo', project: { id: 'p', name: 'Proj' } } as GitRepository;
    const html = renderToStaticMarkup(
      createElement(ReleaseCard, {
        record: rec('tools/a', '1.1.0-rc.1', '2026-11-19T12:00:00Z', { previousTag: 'tools/a/v1.0.0', publishedBy: 'Jane Doe' }),
        repo,
        isLatest: false,
        wikiUrl: 'https://wiki/page',
        showPackage: true,
      }),
    );
    expect(html).toContain('Pre-release');
    expect(html).not.toContain('>Latest<');
    expect(html).toContain('tools/a/v1.1.0-rc.1');
    expect(html).toContain('Changes since tools/a/v1.0.0');
    expect(html).toContain('href="https://wiki/page"');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('<li>change in 1.1.0-rc.1</li>');
  });
});

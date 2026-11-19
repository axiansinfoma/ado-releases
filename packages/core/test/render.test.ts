import { describe, expect, it } from 'vitest';
import { extractReleaseNotesSection, renderNotes } from '../src/notes.js';
import {
  parseReleasePage,
  renderPackagePage,
  renderReleasePage,
  renderRenovateReleases,
  type RenderContext,
} from '../src/render.js';
import type { ReleaseRecord } from '../src/types.js';
import { decodePageName, encodePageName, pageFilePath } from '../src/wikiname.js';

const ctx: RenderContext = {
  repositoryWebUrl: 'https://dev.azure.com/org/Proj/_git/Repo',
  releasePageUrl: (r) => `https://wiki/${r.package}/${r.version}`,
  packagePageUrl: (repo, pkg) => `https://wiki/${repo}/${pkg}`,
};

const rec = (version: string, extra: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
  schema: 1,
  repository: 'Repo',
  package: 'tools/acme',
  version,
  tag: `tools/acme/v${version}`,
  commit: 'abc',
  title: version,
  notes: `## 🐛 Fixes\n\n- fix ${version}\n`,
  prerelease: version.includes('-'),
  publishedAt: '2026-11-19T10:00:00.000Z',
  ...extra,
});

describe('notes', () => {
  it('extracts a release notes section from a PR description', () => {
    const desc = '## Summary\nstuff\n\n## Release notes\n\nUpgrade needs `--force`.\n\n### Detail\nmore\n\n## Testing\nnone';
    expect(extractReleaseNotesSection(desc)).toBe('Upgrade needs `--force`.\n\n### Detail\nmore');
    expect(extractReleaseNotesSection('## Summary\nx')).toBeUndefined();
  });

  it('groups changes and links PRs', () => {
    const md = renderNotes(
      [
        { pullRequestId: 1, title: 'feat(api): add <thing>', url: 'https://pr/1' },
        { pullRequestId: 2, title: 'fix: crash', url: 'https://pr/2', releaseNotes: 'Restart needed.' },
        { title: 'Update docs', commitId: '0123456789' },
        { pullRequestId: 3, title: 'feat!: remove flag' },
      ],
      'https://compare',
    );
    expect(md).toContain('## ⚠️ Breaking changes\n\n- remove flag (!3)');
    expect(md).toContain('## 🚀 Features\n\n- **api:** add &lt;thing&gt; ([!1](https://pr/1))');
    expect(md).toContain('- crash ([!2](https://pr/2))\n  Restart needed.');
    expect(md).toContain('- Update docs (01234567)');
    expect(md.indexOf('Breaking')).toBeLessThan(md.indexOf('Features'));
    expect(md).toContain('[compare](https://compare)');
  });
});

describe('wiki names', () => {
  it('encodes like the Azure DevOps wiki', () => {
    expect(encodePageName('cert-agent')).toBe('cert%2Dagent');
    expect(encodePageName('1.0.0-rc.1')).toBe('1.0.0%2Drc.1');
    expect(encodePageName('My page: a')).toBe('My-page%3A-a');
    expect(decodePageName('My-page%3A-a')).toBe('My page: a');
    expect(pageFilePath(['Releases', 'Container-Images', 'cert-agent', '0.14.4'])).toBe(
      '/Releases/Container%2DImages/cert%2Dagent/0.14.4.md',
    );
    expect(() => encodePageName('a/b')).toThrow();
  });
});

describe('pages', () => {
  it('round-trips the record through the release page', () => {
    const r = rec('1.0.0', { publishedBy: 'Jane' });
    const page = renderReleasePage(r, ctx, true);
    expect(parseReleasePage(page)).toEqual(r);
    expect(page).toContain('`Latest`');
    expect(page).toContain('by Jane');
  });

  it('renders the package overview newest first with demoted headings', () => {
    const page = renderPackagePage('Repo', 'tools/acme', [rec('0.9.0'), rec('1.0.0'), rec('1.1.0-rc.1')], ctx);
    expect(page).toContain('## Latest: [1.0.0]');
    expect(page).toContain('### 🐛 Fixes');
    const rows = page.split('\n').filter((l) => l.startsWith('| ['));
    expect(rows.map((l) => /\[(.*?)\]/.exec(l)![1])).toEqual(['1.1.0-rc.1', '1.0.0', '0.9.0']);
  });

  it('renders the Renovate custom datasource format', () => {
    const out = renderRenovateReleases('Repo', 'tools/acme', [rec('1.0.0'), rec('0.9.0'), rec('1.1.0-rc.1')], ctx);
    expect(out.releases.map((r) => [r.version, r.isStable])).toEqual([
      ['0.9.0', true],
      ['1.0.0', true],
      ['1.1.0-rc.1', false],
    ]);
    expect(out.releases[0]!.changelogContent).toBe('## 🐛 Fixes\n\n- fix 0.9.0');
    expect(out.releases[0]!.changelogUrl).toBe('https://wiki/tools/acme/0.9.0');
    expect(out.sourceUrl).toBe(ctx.repositoryWebUrl);
  });
});

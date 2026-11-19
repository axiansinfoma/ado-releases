import { describe, expect, it } from 'vitest';
import { bumpVersion, compareVersions, formatTag, isPrerelease, parseTag } from '../src/version.js';
import { changeTypeOf, cleanTitle, parseConventionalTitle } from '../src/conventional.js';

describe('version', () => {
  it('parses monorepo and plain tags', () => {
    expect(parseTag('build-tools/cert-agent/v0.14.4')).toEqual({ prefix: 'build-tools/cert-agent', version: '0.14.4' });
    expect(parseTag('refs/tags/v1.2.3')).toEqual({ prefix: '', version: '1.2.3' });
    expect(parseTag('utility/v0.2.6-rc.1')).toEqual({ prefix: 'utility', version: '0.2.6-rc.1' });
    expect(parseTag('release-2024')).toBeUndefined();
  });

  it('formats tags', () => {
    expect(formatTag('a/b', '1.0.0')).toBe('a/b/v1.0.0');
    expect(formatTag('', '1.0.0')).toBe('v1.0.0');
  });

  it('orders by semver precedence', () => {
    const sorted = ['1.0.0', '0.14.10', '1.0.0-rc.2', '0.14.9', '1.0.0-rc.10', '1.0.0-alpha'].sort(compareVersions);
    expect(sorted).toEqual(['0.14.9', '0.14.10', '1.0.0-alpha', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0']);
  });

  it('detects pre-releases and bumps', () => {
    expect(isPrerelease('1.0.0-preview.26569.3')).toBe(true);
    expect(isPrerelease('1.0.0')).toBe(false);
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3-rc.1', 'patch')).toBe('1.2.4');
    expect(bumpVersion(undefined, 'patch')).toBe('0.0.1');
  });
});

describe('conventional titles', () => {
  it('parses type, scope, breaking and strips merge prefix and work items', () => {
    expect(parseConventionalTitle('Merged PR 101: fix(go-tools): clear the backlog #1234')).toEqual({
      type: 'fix',
      scope: 'go-tools',
      breaking: false,
      description: 'clear the backlog',
    });
    expect(parseConventionalTitle('feat!: drop v1 API').breaking).toBe(true);
    expect(parseConventionalTitle('chore: x', 'BREAKING CHANGE: y').breaking).toBe(true);
    expect(parseConventionalTitle('Update README').type).toBe('other');
    expect(cleanTitle('Merged PR 1: feat: a #1 #2')).toBe('feat: a');
  });

  it('derives the change type', () => {
    const t = (s: string) => parseConventionalTitle(s);
    expect(changeTypeOf([t('fix: a'), t('chore: b')])).toBe('patch');
    expect(changeTypeOf([t('fix: a'), t('feat: b')])).toBe('minor');
    expect(changeTypeOf([t('feat!: a')])).toBe('major');
  });
});

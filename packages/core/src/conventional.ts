import type { ChangeType } from './version.js';

/** A parsed conventional-commit style title. */
export interface ConventionalTitle {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

const TITLE = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<desc>.+)$/;

/**
 * Parse a PR title or commit subject as a conventional commit.
 * Strips the "Merged PR 123: " prefix Azure DevOps puts on merge commits and
 * trailing work item references like " #12345".
 */
export function parseConventionalTitle(title: string, body = ''): ConventionalTitle {
  const clean = cleanTitle(title);
  const m = TITLE.exec(clean);
  const breakingFooter = /^BREAKING[ -]CHANGE:/m.test(body);
  if (!m?.groups) {
    return { type: 'other', breaking: breakingFooter, description: clean };
  }
  return {
    type: m.groups.type!.toLowerCase(),
    scope: m.groups.scope || undefined,
    breaking: Boolean(m.groups.bang) || breakingFooter,
    description: m.groups.desc!.trim(),
  };
}

/** Remove the merge prefix and trailing work item references. */
export function cleanTitle(title: string): string {
  return title
    .split('\n')[0]!
    .replace(/^Merged PR \d+:\s*/, '')
    .replace(/(\s+#\d+)+\s*$/, '')
    .trim();
}

/** Change type a set of titles implies: any breaking -> major, any feat -> minor, else patch. */
export function changeTypeOf(titles: ConventionalTitle[]): ChangeType {
  if (titles.some((t) => t.breaking)) return 'major';
  if (titles.some((t) => t.type === 'feat')) return 'minor';
  return 'patch';
}

/** Section a change is listed under in generated notes. */
export function sectionOf(t: ConventionalTitle): 'breaking' | 'features' | 'fixes' | 'other' {
  if (t.breaking) return 'breaking';
  if (t.type === 'feat') return 'features';
  if (t.type === 'fix') return 'fixes';
  return 'other';
}

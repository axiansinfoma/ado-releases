import type { GitRepository, VersionRef } from './ado.js';

const GV: Record<VersionRef['type'], string> = { tag: 'GT', branch: 'GB', commit: 'GC' };

export function pullRequestUrl(repo: GitRepository, id: number): string {
  return `${repo.webUrl}/pullrequest/${id}`;
}

export function tagUrl(repo: GitRepository, tag: string): string {
  return `${repo.webUrl}?version=GT${encodeURIComponent(tag)}`;
}

export function compareUrl(repo: GitRepository, fromTag: string, to: VersionRef): string {
  const base = encodeURIComponent(fromTag);
  const target = encodeURIComponent(to.version);
  return `${repo.webUrl}/branchCompare?baseVersion=GT${base}&targetVersion=${GV[to.type]}${target}&_a=commits`;
}

/**
 * Web URL of a wiki page. `pagePath` is the page path without ".md", e.g. "/Releases/Repo/pkg/1.0.0".
 * Azure DevOps encodes "-" in file names as "%2D" and spaces as "-"; page paths use the decoded form.
 */
export function wikiPageUrl(organizationUrl: string, project: string, wikiName: string, pagePath: string): string {
  return `${organizationUrl}/${encodeURIComponent(project)}/_wiki/wikis/${encodeURIComponent(wikiName)}?pagePath=${encodeURIComponent(pagePath)}`;
}

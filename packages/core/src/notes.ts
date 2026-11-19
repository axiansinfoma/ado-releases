import type { AdoClient, GitRepository, PullRequestRef, VersionRef } from './ado.js';
import { changeTypeOf, cleanTitle, parseConventionalTitle, sectionOf, type ConventionalTitle } from './conventional.js';
import type { ChangeEntry } from './types.js';
import type { ChangeType } from './version.js';
import { compareUrl, pullRequestUrl } from './urls.js';

export interface GenerateNotesOptions {
  project: string;
  repository: GitRepository;
  /** New version: the tag, or a commit/branch when the tag does not exist yet. */
  to: VersionRef;
  /** Previous tag. Without it, all commits up to `to` (bounded) are used. */
  previousTag?: string;
  /** Only changes touching this path, e.g. "/src/build-tools/cert-agent". */
  pathFilter?: string;
  /** Max commits to look at. Default 500. */
  maxCommits?: number;
}

export interface GeneratedNotes {
  markdown: string;
  changes: ChangeEntry[];
  /** Change type the changes imply, for proposing the next version. */
  changeType: ChangeType;
}

/**
 * Generate release notes from the pull requests merged between the previous tag and `to`.
 * Commits without a PR are listed by their subject.
 */
export async function generateNotes(client: AdoClient, opts: GenerateNotesOptions): Promise<GeneratedNotes> {
  const { project, repository } = opts;
  const commits = await client.getCommitRange(
    project,
    repository.id,
    opts.to,
    opts.previousTag ? { version: opts.previousTag, type: 'tag' } : undefined,
    opts.pathFilter,
    opts.maxCommits ?? 500,
  );
  const prByCommit = await client.findPullRequestsForCommits(
    project,
    repository.id,
    commits.map((c) => c.commitId),
  );

  const seenPrs = new Set<number>();
  const changes: ChangeEntry[] = [];
  for (const c of commits) {
    const pr = prByCommit.get(c.commitId) ?? prFromMergeComment(c.comment);
    if (pr) {
      if (seenPrs.has(pr.pullRequestId)) continue;
      seenPrs.add(pr.pullRequestId);
      let description = pr.description;
      let title = pr.title;
      let author = (pr as PullRequestRef).createdBy?.displayName;
      if (description === undefined || !title || !author) {
        const full = await client.getPullRequest(project, repository.id, pr.pullRequestId);
        description = full.description;
        title = full.title;
        author = full.createdBy?.displayName;
      }
      changes.push({
        pullRequestId: pr.pullRequestId,
        title,
        url: pullRequestUrl(repository, pr.pullRequestId),
        releaseNotes: extractReleaseNotesSection(description ?? ''),
        commitId: c.commitId,
        author,
      });
    } else if (!SKIP_CI.test(c.comment.split('\n')[0]!)) {
      // Direct pushes without a PR. Pipeline housekeeping commits ([skip ci]) are left out.
      changes.push({ title: c.comment, commitId: c.commitId, author: c.author?.name });
    }
  }

  const compare = opts.previousTag ? compareUrl(repository, opts.previousTag, opts.to) : undefined;
  return {
    markdown: renderNotes(changes, compare),
    changes,
    changeType: changeTypeOf(changes.map((c) => parseConventionalTitle(c.title, c.releaseNotes ?? ''))),
  };
}

/** Commit subjects of pipeline housekeeping commits, e.g. "chore: bump version to 1.8.2 [skip ci]". */
const SKIP_CI = /\[(skip ci|ci skip|no ci|skip azurepipelines|azurepipelines skip)\]|\*\*\*NO_CI\*\*\*/i;

/** "Merged PR 123: title" -> { id 123 } when the PR query did not find it. */
function prFromMergeComment(comment: string): { pullRequestId: number; title: string; description?: string } | undefined {
  const m = /^Merged PR (\d+):\s*(.*)/.exec(comment);
  return m ? { pullRequestId: Number(m[1]), title: m[2]!.split('\n')[0]!, description: undefined } : undefined;
}

/**
 * Text below a "Release notes" heading (any level) in a PR description, up to the next
 * heading of the same or a higher level. Undefined when there is none or it is empty.
 */
export function extractReleaseNotesSection(description: string): string | undefined {
  const lines = description.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s+release[\s-]*notes\s*:?\s*$/i.test(l.trim()));
  if (start < 0) return undefined;
  const level = /^#+/.exec(lines[start]!.trim())![0].length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const h = /^(#{1,6})\s/.exec(line.trim());
    if (h && h[1]!.length <= level) break;
    body.push(line);
  }
  const text = body.join('\n').trim();
  return text || undefined;
}

const SECTIONS: Array<[ReturnType<typeof sectionOf>, string]> = [
  ['breaking', '⚠️ Breaking changes'],
  ['features', '🚀 Features'],
  ['fixes', '🐛 Fixes'],
  ['other', '🧰 Other changes'],
];

/** Render change entries as Markdown, grouped by conventional-commit type. */
export function renderNotes(changes: ChangeEntry[], compareLink?: string): string {
  const groups = new Map<string, string[]>();
  for (const change of changes) {
    const t: ConventionalTitle = parseConventionalTitle(change.title, change.releaseNotes ?? '');
    const scope = t.scope ? `**${t.scope}:** ` : '';
    // like GitHub: "… by <author> in <PR>"; changes without a PR show the commit
    const by = change.author ? ` by ${escapeInline(change.author)}` : '';
    const ref =
      change.pullRequestId !== undefined
        ? change.url
          ? `${by} in [!${change.pullRequestId}](${change.url})`
          : `${by} in !${change.pullRequestId}`
        : change.commitId
          ? `${by} (${change.commitId.slice(0, 8)})`
          : by;
    let entry = `- ${scope}${escapeInline(t.type === 'other' ? cleanTitle(change.title) : t.description)}${ref}`;
    if (change.releaseNotes) {
      entry += '\n' + change.releaseNotes.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n');
    }
    const key = sectionOf(t);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const parts: string[] = [];
  for (const [key, heading] of SECTIONS) {
    const entries = groups.get(key);
    if (entries?.length) parts.push(`## ${heading}\n\n${entries.join('\n')}`);
  }
  if (!parts.length) parts.push('_No changes found._');
  if (compareLink) parts.push(`**Full changes:** [compare](${compareLink})`);
  return parts.join('\n\n') + '\n';
}

/** Keep titles from breaking the surrounding Markdown (no HTML, no stray link syntax at line start). */
function escapeInline(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
